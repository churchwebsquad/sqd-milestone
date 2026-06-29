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
import { snapshotPageVersion } from './webPageVersions'
import { LIBRARY_CONCEPTS, parseCuratedLibrary, getEffectiveBindings, findCandidateConcepts, CONCEPT_DEFAULT_ROLE } from './webCuratedLibrary'
import {
  composeBind, rankVariantsByBrief, extractSectionIdFromNotes,
} from './webBindTemplate'
import { sectionId, sectionFamily, sectionFields } from './webPageBrief'
import {
  familyUsage, isNarrowUseFamily, CONTENT_FALLBACK_FAMILIES,
} from './webBrixiesFamilies'
import type { BriefSection, BriefHero, PageBrief } from './webPageBrief'
import type {
  WebContentTemplate, WebSlotDef, WebGroupDef,
  WebSection, StrategyWebProject,
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

/** Build a short human-readable shape string for a template — for the
 *  AI prompt, e.g. "tagline + heading + body + 4-card grid + 2 CTAs". */
function summarizeTemplateShape(template: WebContentTemplate): string {
  const parts: string[] = []
  const slots: string[] = []
  const groups: string[] = []
  for (const f of template.fields) {
    if (f.kind === 'slot') {
      const s = f as WebSlotDef
      slots.push(s.key)
    } else {
      const g = f as WebGroupDef
      groups.push(`${g.default_count}-${g.key}`)
    }
  }
  if (slots.length > 0) parts.push(slots.join(' + '))
  if (groups.length > 0) parts.push(groups.join(', '))
  return parts.join(' · ') || '(no fields)'
}

/** Walk a template's fields (recursively into groups) and emit boolean
 *  structural flags the AI uses to match against the brief's needs. */
function summarizeTemplateStructure(template: WebContentTemplate): Record<string, unknown> {
  let hasTagline = false
  let hasHeading = false
  let hasBody = false
  let hasImage = false
  let ctaSlotCount = 0
  let cardGroupCount = 0
  let largestCardGroupSize = 0
  let hasStepGroup = false
  let stepGroupSize = 0
  const visit = (fields: ReadonlyArray<WebSlotDef | WebGroupDef>) => {
    for (const f of fields) {
      if (f.kind === 'slot') {
        const c = (s: string) => s.toLowerCase().replace(/[_\s-]+/g, '')
        const key = c(f.key)
        if (key.includes('tagline') || key.includes('eyebrow')) hasTagline = true
        if (key.includes('heading') || key === 'h' || key.includes('title')) hasHeading = true
        if (key.includes('body') || key.includes('description') || key.includes('content')) hasBody = true
        if (f.type === 'image') hasImage = true
        if (f.type === 'cta' || (f.type === 'text' && f.scope === 'button')) ctaSlotCount++
      } else {
        const groupCanon = f.key.toLowerCase().replace(/[_\s-]+/g, '')
        if (/^(cards?|items?|features?|tiles?|blocks?)$/.test(groupCanon)
            || groupCanon.includes('card')) {
          cardGroupCount++
          largestCardGroupSize = Math.max(largestCardGroupSize, f.default_count)
        }
        if (groupCanon.includes('step') || groupCanon.includes('process')) {
          hasStepGroup = true
          stepGroupSize = Math.max(stepGroupSize, f.default_count)
        }
        if (groupCanon.includes('button') || groupCanon.includes('cta')) {
          ctaSlotCount += f.default_count
        }
        visit(f.item_schema as ReadonlyArray<WebSlotDef | WebGroupDef>)
      }
    }
  }
  visit(template.fields as ReadonlyArray<WebSlotDef | WebGroupDef>)
  return {
    has_tagline: hasTagline,
    has_heading: hasHeading,
    has_body: hasBody,
    has_image: hasImage,
    cta_count: ctaSlotCount,
    card_group_count: cardGroupCount,
    largest_card_group: largestCardGroupSize,
    has_step_group: hasStepGroup,
    step_group_size: stepGroupSize,
  }
}

/** Slim brief context for the AI prompt — heading + body preview +
 *  structural presence flags (tagline / image / cta count / step count /
 *  card count). The structural flags are critical for variant pick
 *  quality: when the brief has a tagline, the AI MUST pick a variant
 *  with a tagline slot, or the tagline ends up as overflow. */
function summarizeBriefSection(s: BriefSection): Record<string, unknown> {
  const fields = sectionFields(s)
  const heading = typeof fields.h === 'string' ? fields.h
    : typeof fields.heading === 'string' ? fields.heading
    : typeof fields.h1 === 'string' ? fields.h1
    : ''
  const tagline = typeof fields.tagline === 'string' ? fields.tagline : ''
  const body = typeof fields.content === 'string' ? fields.content
    : typeof fields.body === 'string' ? fields.body
    : typeof fields.description === 'string' ? fields.description
    : ''
  const intro = typeof fields.intro === 'string' ? fields.intro : ''
  const stepCount = Array.isArray(fields.steps) ? fields.steps.length : 0
  const cardCount = Array.isArray(fields.cards) ? fields.cards.length
    : Array.isArray(fields.items) ? fields.items.length
    : Array.isArray(fields.pillars) ? fields.pillars.length
    : Array.isArray(fields.tiers) ? fields.tiers.length
    : Array.isArray(fields.programs) ? fields.programs.length
    : Array.isArray(fields.classes) ? fields.classes.length
    : Array.isArray(fields.members) ? fields.members.length
    : 0
  // CTA count: hero/section-level CTAs + any nested step inline_ctas
  const sectionCtas = [fields.cta, fields.primary_cta, fields.secondary_cta]
    .filter(v => typeof v === 'object' && v !== null).length
  const stepCtas = Array.isArray(fields.steps)
    ? (fields.steps as Array<Record<string, unknown>>).filter(s => s.inline_cta || s.cta_inline || s.cta).length
    : 0
  const ctaCount = sectionCtas + stepCtas
  const hasImage = typeof fields.image === 'string' && fields.image !== ''

  // Longer body preview for prose density signal — 400 chars.
  const bodyPreview = (body || intro).slice(0, 400)
  return {
    heading,
    tagline: tagline || null,
    has_tagline: tagline !== '',
    body_preview: bodyPreview,
    body_length_chars: (body || intro).length,
    has_intro: !!intro,
    has_image: hasImage,
    step_count: stepCount,
    card_count: cardCount,
    cta_count: ctaCount,
    purpose: s.purpose,
    voice_notes: s.voice_notes,
  }
}

/** Convert a BriefHero into a synthetic BriefSection so the same
 *  scoring + binding path works for both. */
function heroAsBriefSection(hero: BriefHero): BriefSection {
  // Hero gets fields as top-level flat keys (cowork's shape) — tagline,
  // h1, body, primary_cta, secondary_cta.
  return {
    section_id: '__hero__',
    template_family: 'Hero Section',
    purpose: 'Hero block',
    ...(hero as unknown as Record<string, unknown>),
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
  const family = sectionFamily(briefSection)
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

interface SectionPlan {
  webSection: WebSection
  briefSection: BriefSection
  sectionLabel: string
  family: string
  /** Candidates from the project's curated library, ranked. */
  curatedRanked: WebContentTemplate[]
  /** Catalog-wide candidates filtered by family, ranked. */
  catalogRanked: WebContentTemplate[]
}

/** Auto-bind every just-imported freehand section on a page. Idempotent
 *  per page — re-running re-applies bindings to anything currently
 *  freehand and doesn't disturb sections that already have a template.
 *  Calls the bulk AI endpoint to refine variant choice; falls back to
 *  the deterministic ranker if the AI call fails. */
export async function autoBindPageSections(
  pageId: string,
  brief: PageBrief,
  project: StrategyWebProject,
): Promise<PageAutoBindResult> {
  // Snapshot the page's pre-bind state so the strategist can revert if
  // autoBind's variant picks land somewhere unexpected. Awaited (not
  // fire-and-forget) — the snapshot READS pages + sections, so it must
  // finish before the mutation loop below starts touching the same
  // rows. Failure is non-fatal; we proceed without a revert point and
  // log the warning. createdBy stamps the snapshot with the current
  // staff user so the version drawer shows who triggered the run.
  const { data: { session } } = await supabase.auth.getSession()
  await snapshotPageVersion(supabase, pageId, {
    triggerKind:  'agent_run',
    triggerLabel: `Auto-bind sections — ${brief.page_name || brief.page_slug || pageId.slice(0, 8)}`,
    createdBy:    session?.user?.id ?? null,
  })

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

  // ── Pass 1: build a plan for every freehand section ────────────────
  const plans: SectionPlan[] = []
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
        briefSection = briefSections.find(s => sectionId(s) === briefId) ?? null
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

    const family = sectionFamily(briefSection)
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
    const curatedIds = conceptId ? getEffectiveBindings(curatedLibrary, conceptId) : []
    const curatedCandidates = catalog.filter(t => curatedIds.includes(t.id))

    // Catalog candidates — start with the brief's suggested family, then
    // ALWAYS widen the pool with the content-fallback families (Feature,
    // Content, Intro, CTA) so the AI can override a misclassified hint.
    // When the brief's family is narrow-use (Banner Section, etc.), we
    // STILL include those candidates but the agent prompt tells the AI
    // not to pick them for paragraph content. Final dedup by id.
    const primaryFamilyCandidates = catalog.filter(t => familyMatches(t.family, family))
    const fallbackCandidates = catalog.filter(t =>
      CONTENT_FALLBACK_FAMILIES.some(f => familyMatches(t.family, f))
    )
    const seenIds = new Set<string>()
    const catalogCandidates: WebContentTemplate[] = []
    for (const t of [...primaryFamilyCandidates, ...fallbackCandidates]) {
      if (seenIds.has(t.id)) continue
      seenIds.add(t.id)
      catalogCandidates.push(t)
    }

    if (curatedCandidates.length === 0 && catalogCandidates.length === 0) {
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

    plans.push({
      webSection,
      briefSection,
      sectionLabel,
      family,
      curatedRanked: rankVariantsByBrief(briefSection, curatedCandidates).map(r => r.template),
      catalogRanked: rankVariantsByBrief(briefSection, catalogCandidates).map(r => r.template),
    })
  }

  // ── Pass 2: bulk AI variant picker (one call, all sections) ────────
  const aiPicks = await callAutoBindAgent(plans, brief)

  // ── Pass 3: apply picks (AI when available, else deterministic top) ─
  for (const plan of plans) {
    // AI's pick wins; else top of curated-then-catalog ranking.
    const aiPick = aiPicks.find(p => p.section_id === sectionId(plan.briefSection) || p.section_id === plan.sectionLabel)
    const curatedIds = new Set(plan.curatedRanked.map(t => t.id))

    let chosenTemplate: WebContentTemplate | null = null
    let source: 'curated' | 'catalog' = 'catalog'
    let rationale = ''

    if (aiPick) {
      const combined = [...plan.curatedRanked, ...plan.catalogRanked]
      const tpl = combined.find(t => t.id === aiPick.template_id)
      if (tpl) {
        chosenTemplate = tpl
        source = curatedIds.has(tpl.id) ? 'curated' : 'catalog'
        rationale = `${source === 'curated' ? 'Site library · ' : ''}${aiPick.rationale}`
      }
    }
    if (!chosenTemplate) {
      // Fallback: deterministic top of curated, else catalog.
      if (plan.curatedRanked.length > 0) {
        chosenTemplate = plan.curatedRanked[0]
        source = 'curated'
        rationale = 'Site library · top-ranked fit (AI unavailable)'
      } else if (plan.catalogRanked.length > 0) {
        chosenTemplate = plan.catalogRanked[0]
        source = 'catalog'
        rationale = 'Catalog top-ranked fit (AI unavailable)'
      }
    }

    if (!chosenTemplate) {
      bindings.push({
        web_section_id: plan.webSection.id,
        section_label: plan.sectionLabel,
        template_id: null,
        template_layer_name: null,
        source: 'none',
        rationale: 'No candidates after ranking',
      })
      continue
    }

    // Resolve field_values from brief + body HTML using the same
    // composeBind path as the manual bind flow. Only the residual
    // (chunks of the freehand body that didn't make it into any slot)
    // gets stashed as __overflow_html — if everything mapped cleanly,
    // no overflow panel renders.
    const currentValues = (plan.webSection.field_values ?? {}) as Record<string, unknown>
    const sourceHtml = typeof currentValues.body === 'string' ? currentValues.body : ''
    const composed = composeBind(plan.briefSection, sourceHtml, chosenTemplate)
    const nextValues: Record<string, unknown> = { ...composed.field_values }
    if (composed.residual_html) nextValues.__overflow_html = composed.residual_html
    if (composed.source_report.missing_slots.length > 0
        || composed.source_report.unmatched_brief_keys.length > 0) {
      nextValues.__bind_report = composed.source_report
    }

    // Set section_role from the chosen template's library concept (if
    // exactly one candidate concept has a default role mapped). Leaves
    // the existing role alone when the section already has one set
    // (preserves strategist overrides). Skips when the concept match
    // is ambiguous so the strategist can pick manually instead of
    // landing on a wrong role.
    const candidateConcepts = findCandidateConcepts({
      id:     chosenTemplate.id,
      family: chosenTemplate.family,
      kind:   chosenTemplate.kind,
    })
    const roleFromConcept = (() => {
      if (plan.webSection.section_role) return null  // don't overwrite
      const roles = candidateConcepts
        .map(c => CONCEPT_DEFAULT_ROLE[c.id])
        .filter((r): r is NonNullable<typeof r> => !!r)
      const unique = Array.from(new Set(roles))
      return unique.length === 1 ? unique[0] : null
    })()

    const { error: updateErr } = await supabase
      .from('web_sections')
      .update({
        content_template_id: chosenTemplate.id,
        field_values: nextValues,
        ...(roleFromConcept ? { section_role: roleFromConcept } : {}),
      } as never)
      .eq('id', plan.webSection.id)
    if (updateErr) {
      bindings.push({
        web_section_id: plan.webSection.id,
        section_label: plan.sectionLabel,
        template_id: null,
        template_layer_name: null,
        source: 'none',
        rationale: `DB write failed: ${updateErr.message}`,
      })
      continue
    }

    bindings.push({
      web_section_id: plan.webSection.id,
      section_label: plan.sectionLabel,
      template_id: chosenTemplate.id,
      template_layer_name: chosenTemplate.layer_name,
      source,
      rationale,
    })
  }

  return {
    bindings,
    curated_used: bindings.filter(b => b.source === 'curated').length,
    catalog_used: bindings.filter(b => b.source === 'catalog').length,
    unbound: bindings.filter(b => b.source === 'none').length,
  }
}

/** Call the bulk auto-bind agent with one round-trip for the whole page.
 *  Returns [] on failure — the caller falls back to deterministic top
 *  picks so the import never blocks on AI availability. */
async function callAutoBindAgent(
  plans: SectionPlan[],
  brief: PageBrief,
): Promise<Array<{ section_id: string; template_id: string; rationale: string }>> {
  if (plans.length === 0) return []
  const { data: sessionData } = await supabase.auth.getSession()
  const token = sessionData.session?.access_token
  if (!token) return []

  // Cap candidates per section for prompt size — top 5 curated, top 8
  // from the brief's suggested family, top 6 from content-fallback
  // families combined. Deduped. The deterministic ranking already
  // surfaces the best structural fits at the head of each list.
  const sections = plans.map(plan => {
    const curatedIds = new Set(plan.curatedRanked.slice(0, 5).map(t => t.id))
    const briefFamilyTrimmed = plan.catalogRanked
      .filter(t => !curatedIds.has(t.id))
      .filter(t => familyMatches(t.family, plan.family))
      .slice(0, 8)
    const briefFamilyIds = new Set(briefFamilyTrimmed.map(t => t.id))
    const fallbackTrimmed = plan.catalogRanked
      .filter(t => !curatedIds.has(t.id) && !briefFamilyIds.has(t.id))
      .filter(t => CONTENT_FALLBACK_FAMILIES.some(f => familyMatches(t.family, f)))
      .slice(0, 6)
    const merged = [
      ...plan.curatedRanked.slice(0, 5),
      ...briefFamilyTrimmed,
      ...fallbackTrimmed,
    ]
    return {
      section_id: sectionId(plan.briefSection) || plan.sectionLabel,
      brief_suggested_family: plan.family,
      context: summarizeBriefSection(plan.briefSection),
      candidates: merged.map(t => ({
        id: t.id,
        family: t.family,
        family_usage: familyUsage(t.family),
        layer_name: t.layer_name,
        kind: t.kind,
        fields_summary: summarizeTemplateShape(t),
        structure: summarizeTemplateStructure(t),
        is_site_pick: curatedIds.has(t.id),
        is_brief_family: familyMatches(t.family, plan.family),
        is_narrow_use: isNarrowUseFamily(t.family),
      })),
    }
  })

  const pageContext =
    `Page: ${brief.page_title ?? ''} (slug: ${brief.page_slug ?? ''}). ` +
    `Purpose: ${brief.page_purpose ?? '(none)'}. ` +
    `Persona: ${brief.primary_persona ?? '(none)'}.`

  try {
    const resp = await fetch('/api/web/agents/auto-bind-page', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ pageContext, sections }),
    })
    if (!resp.ok) {
      console.warn('[auto-bind] non-200', resp.status, await resp.text())
      return []
    }
    const data = await resp.json() as {
      picks?: Array<{ section_id: string; template_id: string; rationale: string }>
    }
    return Array.isArray(data.picks) ? data.picks : []
  } catch (e) {
    console.warn('[auto-bind] fetch failed:', e)
    return []
  }
}
