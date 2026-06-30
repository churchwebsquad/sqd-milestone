// Content-Model Formation Plan — Layer 1 / 2 / 3 emitters.
//
// Three logical sections:
//
//   PART A: classifyOne — runs the §6 routing rules on a single
//           content piece (one template field on one section) and
//           returns a ClassificationRecord.
//
//   PART B: buildWpObjects — aggregates the classifications into
//           Layer 2 WpObjects: one Options page + N CPTs + N
//           Repeater targets + N External references. Multi-campus
//           aware (campus-scoped globals get an open_question
//           instead of being seeded flat).
//
//   PART C: buildAcfFieldGroups — emits Layer 3 ACF JSON Sync
//           field groups, mapping WebFieldType → AcfFieldType and
//           expanding WebGroupDef → ACF repeater with sub_fields.
//
// All functions are pure — they read FormationInputs and the
// upstream layers, return values, mutate nothing.

import type {
  SectionRole,
  WebContentTemplate,
  WebFieldDef,
  WebGroupDef,
  WebPage,
  WebSection,
  WebSlotDef,
} from '../../types/database'
import type {
  AcfField,
  AcfFieldGroup,
  AcfFieldType,
  AcfLocationRule,
  ArchiveSpec,
  ClassificationRecord,
  ClassificationSignals,
  Confidence,
  CtaTargetKind,
  CptRegistrationArgs,
  EditFrequencyProxy,
  SingleTemplateSpec,
  Structure,
  TaxonomySpec,
  WpObject,
  WpObjectCpt,
  WpObjectExternal,
  WpObjectOptionsPage,
  WpObjectRepeater,
} from './types'
import type { CampusTerm, FormationInputs } from './sources'
import { extractSnippetTokens, resolveDisplayPreference } from './sources'
import {
  ACF_TYPE_BY_FIELD_TYPE,
  BRICKS_NESTABLE_PREFERRED_ROLES,
  CAMPUS_SCOPED_COLUMNS,
  CANONICAL_GROUP_FIELDS,
  CANONICAL_SERMON_FIELDS,
  CHROME_ROLES,
  CHURCH_WIDE_GLOBAL_COLUMNS,
  CPT_FROM_CONTENT_KIND,
  CPT_MENU_ICON,
  CPT_SECTION_ROLES,
  CPT_SINGLE_TEMPLATE_DEFAULT,
  CPT_SLUG_BY_ROLE,
  CPT_SUPPORTS,
  HIGH_EDIT_ROLES,
  MULTIPLE_LOCATION_ROLES,
  STRUCTURE_DEFAULT_BY_ROLE,
  TAXONOMY_SUGGESTIONS,
  groupCanonicalShape,
  sermonCanonicalShape,
  type CanonicalCptField,
} from './rules'

// ═════════════════════════════════════════════════════════════════════
// PART A — classify one content piece
// ═════════════════════════════════════════════════════════════════════

interface ClassifyContext {
  inputs:       FormationInputs
  page:         WebPage
  section:      WebSection
  template:     WebContentTemplate | null
  /** When this classification is for a SUB-field of a group (e.g. one
   *  card's title), this is the parent group's key. Pure-slot top-
   *  level classifications leave it undefined. */
  groupKey?:    string
}

/** Classify a single template field on a single section.
 *
 *  Called once per top-level WebFieldDef. Repeater sub-fields are
 *  emitted as part of the parent's ACF field group, not as separate
 *  classification records. */
export function classifyOne(
  ctx: ClassifyContext,
  fieldDef: WebFieldDef,
): ClassificationRecord {
  const { inputs, page, section } = ctx
  const sectionRole = section.section_role
  const filledValue = (section.field_values as Record<string, unknown> | null)?.[fieldDef.key]

  // ── Signals ─────────────────────────────────────────────────────
  const kindInTemplate: 'slot' | 'group' = fieldDef.kind
  const defaultCount =
    fieldDef.kind === 'group' ? fieldDef.default_count : null
  const actuallyFilledCount = Array.isArray(filledValue)
    ? filledValue.length
    : null
  const reuseCount = sectionRole
    ? (inputs.sectionRoleCounts.get(sectionRole) ?? 0)
    : 0
  const hasClientOverrides = sectionHasOverrides(section)
  const editFrequencyProxy: EditFrequencyProxy =
    sectionRole && HIGH_EDIT_ROLES.has(sectionRole)
      ? 'high'
      : hasClientOverrides
        ? 'medium'
        : 'low'
  const isFeaturedGlobal =
    sectionRole != null &&
    MULTIPLE_LOCATION_ROLES.has(sectionRole) &&
    reuseCount >= 2
  const needsOwnUrl =
    sectionRole != null && [
      'event_detail',
      'post_detail',
      'staff_member_detail',
      'career_detail',
    ].includes(sectionRole)
  const ctaTargetKind = classifyCtaTarget(filledValue)
  const externalSystem = detectExternalSystem(inputs, sectionRole, filledValue)
  const signals: ClassificationSignals = {
    kind_in_template:        kindInTemplate,
    default_count:           defaultCount,
    actually_filled_count:   actuallyFilledCount,
    section_role_reuse_count: reuseCount,
    edit_frequency_proxy:    editFrequencyProxy,
    is_featured_global:      isFeaturedGlobal,
    needs_own_url:           needsOwnUrl,
    external_system:         externalSystem,
    cta_target_kind:         ctaTargetKind,
    has_client_overrides:    hasClientOverrides,
  }

  // ── Apply routing rules (§6 order) ─────────────────────────────
  const { structure, rationale, confidence, open_questions, alternative } =
    applyRoutingRules({ ctx, fieldDef, signals })

  // ── Frequency overlay ──────────────────────────────────────────
  const overlay: string[] = []
  if (
    sectionRole && HIGH_EDIT_ROLES.has(sectionRole) &&
    (structure === 'PLAIN_FIELD' ||
     (structure === 'REPEATER' && parentIsFlexible(ctx)))
  ) {
    overlay.push(
      'High-edit content buried under a non-editor-friendly structure — consider promoting to CPT or Options for non-technical editing.'
    )
  }

  // ── ID stability: page_slug/item_label so re-runs match prior records ──
  const itemLabel = deriveItemLabel(fieldDef, sectionRole)
  const id = `${page.slug}/${itemLabel}`

  // ── CPT linkage ────────────────────────────────────────────────
  const cptRef =
    structure === 'CUSTOM_POST_TYPE'
      ? cptIdForSectionRole(sectionRole)
      : null

  return {
    id,
    page_slug:           page.slug,
    page_id:             page.id,
    section_id:          section.id,
    section_role:        sectionRole,
    item_label:          itemLabel,
    structure,
    signals,
    rationale: [rationale, ...overlay].filter(Boolean).join(' '),
    recommended_default: structure,
    alternative,
    open_questions,
    confidence,
    cpt_subroutine_ref:  cptRef,
    status:              'suggested',
    override_reason:     null,
  }
}

// ── Rule application ─────────────────────────────────────────────────

interface RuleResult {
  structure:        Structure
  rationale:        string
  confidence:       Confidence
  open_questions:   string[]
  alternative:      Structure | null
}

function applyRoutingRules(args: {
  ctx: ClassifyContext
  fieldDef: WebFieldDef
  signals: ClassificationSignals
}): RuleResult {
  const { ctx, fieldDef, signals } = args
  const sectionRole = ctx.section.section_role
  const isSlot = fieldDef.kind === 'slot'
  const slotDef = isSlot ? (fieldDef as WebSlotDef) : null

  // RULE 1 — Auto-populated slot → Options
  if (slotDef?.auto_populated) {
    return {
      structure: 'GLOBAL_OPTIONS',
      rationale: `Template flagged \`${slotDef.key}\` as auto_populated — bind to the global Options page rather than per-section storage.`,
      confidence: 'high',
      open_questions: [],
      alternative: null,
    }
  }

  // RULE 1b — Slot value references a {{token}} that resolves to a project global
  if (signals.kind_in_template === 'slot') {
    const filled = (ctx.section.field_values as Record<string, unknown> | null)?.[fieldDef.key]
    const tokens = extractSnippetTokens(filled)
    if (tokens.size > 0) {
      // Treat as Options-bound — the snippet IS the global.
      return {
        structure: 'GLOBAL_OPTIONS',
        rationale: `Field references global token(s) ${[...tokens].map(t => `{{${t}}}`).join(', ')} — bind via the Options page rather than per-section.`,
        confidence: 'high',
        open_questions: [],
        alternative: null,
      }
    }
  }

  // RULE 2 — External display preference (events / sermons / groups)
  if (sectionRole) {
    const contentKind = contentKindForSectionRole(sectionRole)
    if (contentKind) {
      const shape = resolveDisplayPreference(
        contentKind,
        ctx.inputs.displayPreferences[contentKind],
      )
      if (shape.kind === 'external') {
        return {
          structure: 'EXTERNAL',
          rationale: shape.rationale,
          confidence: 'high',
          open_questions: [],
          alternative: null,
        }
      }
    }
  }

  // RULE 3 — Custom Post Type by SectionRole
  if (sectionRole && CPT_SECTION_ROLES.has(sectionRole)) {
    const slug = CPT_SLUG_BY_ROLE[sectionRole]
    const open_questions: string[] = []
    const singleDefault = CPT_SINGLE_TEMPLATE_DEFAULT[sectionRole]
    if (singleDefault === 'maybe') {
      open_questions.push(
        `Do these ${slug} records need their own detail pages on the site, or is a flat listing enough? The partner hasn't been explicit.`
      )
    }
    return {
      structure: 'CUSTOM_POST_TYPE',
      rationale: `SectionRole \`${sectionRole}\` maps to CPT \`${slug}\`.`,
      confidence: singleDefault === 'maybe' ? 'medium' : 'high',
      open_questions,
      alternative: null,
    }
  }

  // RULE 4 — Cross-page reuse → Global
  if (
    sectionRole &&
    MULTIPLE_LOCATION_ROLES.has(sectionRole) &&
    signals.section_role_reuse_count >= 2
  ) {
    return {
      structure: 'GLOBAL_OPTIONS',
      rationale: `SectionRole \`${sectionRole}\` appears on ${signals.section_role_reuse_count} approved pages — promote to Options so edits propagate site-wide.`,
      confidence: 'high',
      open_questions: [],
      alternative: null,
    }
  }

  // RULE 5 — Template-declared repeater (WebGroupDef)
  if (fieldDef.kind === 'group') {
    const usesNestableDefault =
      sectionRole != null && BRICKS_NESTABLE_PREFERRED_ROLES.has(sectionRole)
    return {
      structure: 'REPEATER',
      rationale: `Template field \`${fieldDef.key}\` is declared as a group with ${fieldDef.default_count} default items — emit as ACF repeater (or Bricks Nestable section, surfaced as alternative).`,
      confidence: 'high',
      open_questions: [],
      alternative: usesNestableDefault ? 'BRICKS_NESTABLE_SECTION' : null,
    }
  }

  // RULE 6 — Flexible Content (page-level signal, not per-field)
  //   Detected at page-level inside buildWpObjects when the page has
  //   5+ sections with no shared section_role pattern. Skipped here.

  // RULE 7 — Group (fixed cluster of slots — heuristic: section_role
  //   is hero_* / cta_banner_*)
  if (sectionRole && (
    sectionRole.startsWith('hero_') ||
    sectionRole.startsWith('cta_banner_') ||
    sectionRole === 'cta_full_bleed' ||
    sectionRole === 'feature_split'
  )) {
    return {
      structure: 'GROUP',
      rationale: `SectionRole \`${sectionRole}\` is a fixed cluster of related slots — emit as ACF group.`,
      confidence: 'high',
      open_questions: [],
      alternative: null,
    }
  }

  // RULE 8 — SectionRole default
  if (sectionRole && STRUCTURE_DEFAULT_BY_ROLE[sectionRole]) {
    return {
      structure: STRUCTURE_DEFAULT_BY_ROLE[sectionRole]!,
      rationale: `SectionRole \`${sectionRole}\` defaults to ${STRUCTURE_DEFAULT_BY_ROLE[sectionRole]} per the curated mapping.`,
      confidence: 'medium',
      open_questions: [],
      alternative: null,
    }
  }

  // Fallback — single slot, unknown role → Plain field, low confidence
  return {
    structure: 'PLAIN_FIELD',
    rationale: 'No rule matched — defaulting to PLAIN_FIELD.',
    confidence: 'low',
    open_questions: ['This content piece has no recognized section role or template signal — strategist needs to tag what it is.'],
    alternative: null,
  }
}

// ── Classify helpers ─────────────────────────────────────────────────

function sectionHasOverrides(section: WebSection): boolean {
  const fp = section.field_provenance as Record<string, { source?: string }> | null
  if (!fp) return false
  return Object.values(fp).some(entry => entry?.source === 'override')
}

function deriveItemLabel(fieldDef: WebFieldDef, role: SectionRole | null): string {
  // Stable: field key always wins. Fallback to role for sections
  // whose template hasn't been linked yet.
  return fieldDef.key || role || 'unknown'
}

function classifyCtaTarget(value: unknown): CtaTargetKind {
  const url = extractFirstUrl(value)
  if (!url) return 'unset'
  if (url.startsWith('mailto:')) return 'mailto'
  if (url.startsWith('tel:')) return 'tel'
  if (url.startsWith('#')) return 'internal-anchor'
  if (/^https?:\/\//i.test(url)) return 'external'
  if (url.startsWith('/')) return 'internal-page'
  return 'unset'
}

function extractFirstUrl(value: unknown): string | null {
  if (value == null) return null
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    for (const item of value) {
      const u = extractFirstUrl(item)
      if (u) return u
    }
    return null
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    if (typeof obj.url === 'string') return obj.url
    for (const v of Object.values(obj)) {
      const u = extractFirstUrl(v)
      if (u) return u
    }
  }
  return null
}

function detectExternalSystem(
  inputs: FormationInputs,
  role: SectionRole | null,
  value: unknown,
): ClassificationSignals['external_system'] {
  if (!role) return null
  const contentKind = contentKindForSectionRole(role)
  if (contentKind) {
    const shape = resolveDisplayPreference(contentKind, inputs.displayPreferences[contentKind])
    if (shape.kind === 'external') {
      const url = extractFirstUrl(value) ?? ''
      if (/churchcenter|planningcenter/i.test(url)) return 'church-center'
      if (/ccbchurch|churchcommunitybuilder/i.test(url)) return 'ccb'
      if (/youtube|youtu\.be/i.test(url)) return 'youtube'
      if (/vimeo/i.test(url)) return 'vimeo'
      return 'external'
    }
  }
  return null
}

function contentKindForSectionRole(role: SectionRole): 'events' | 'sermons' | 'groups' | null {
  if (role === 'event_detail') return 'events'
  // sermons + groups roles don't exist in the enum — see §1 of audit.
  return null
}

function cptIdForSectionRole(role: SectionRole | null): string | null {
  if (!role) return null
  const slug = CPT_SLUG_BY_ROLE[role]
  return slug ? `wp_object.${slug}` : null
}

function parentIsFlexible(_ctx: ClassifyContext): boolean {
  // Page-level Flexible Content detection is done in PART B; this
  // is a stub used by the frequency overlay to avoid double-counting.
  return false
}

// ═════════════════════════════════════════════════════════════════════
// PART B — build WpObjects (CPTs / Options / Repeaters / Externals)
// ═════════════════════════════════════════════════════════════════════

/** Aggregates Layer 1 classifications into Layer 2 WpObjects. Also
 *  emits the multi-campus-aware Options page even when no
 *  classification routed to GLOBAL_OPTIONS, because the project's
 *  CHURCH_WIDE_GLOBAL_COLUMNS always seed the Options page. */
export function buildWpObjects(
  classifications: ClassificationRecord[],
  inputs: FormationInputs,
): WpObject[] {
  const objects: WpObject[] = []

  // ── Options page (always emitted, multi-campus-aware) ─────────
  objects.push(buildOptionsPage(inputs))

  // ── CPTs from SectionRole routing ─────────────────────────────
  const cptSlugsFromRoles = new Set<string>()
  for (const c of classifications) {
    if (c.structure !== 'CUSTOM_POST_TYPE' || !c.section_role) continue
    const slug = CPT_SLUG_BY_ROLE[c.section_role]
    if (!slug) continue
    cptSlugsFromRoles.add(slug)
  }
  for (const slug of cptSlugsFromRoles) {
    objects.push(buildCptFromRoles(slug, classifications, inputs))
  }

  // ── CPTs (and Externals) from content-collection display prefs ─
  for (const kind of ['events', 'sermons', 'groups'] as const) {
    const shape = resolveDisplayPreference(kind, inputs.displayPreferences[kind])
    if (shape.kind === 'skip') continue
    const slug = CPT_FROM_CONTENT_KIND[kind]
    if (shape.kind === 'cpt') {
      // De-dupe against role-driven CPTs (events_detail might have
      // already produced wp_object.event).
      if (!objects.some(o => o.kind === 'custom_post_type' && o.slug === slug)) {
        objects.push(buildCptFromDisplayPref(slug, kind, shape, inputs))
      }
    } else {
      objects.push({
        id:               `wp_object.external.${kind}`,
        kind:             'external',
        section_role:     null,
        external_system:  null,
        display_mode:     displayModeFromPref(inputs.displayPreferences[kind]),
        rationale:        shape.rationale,
      })
    }
  }

  // ── Repeaters per page that landed on REPEATER + don't roll up ─
  // Dedup by id — multiple sections on the same page can reference
  // the same template field key (e.g. several sections each have a
  // `buttons` group), and they should collapse to ONE Repeater
  // WpObject per (page, item) pair. Layer 3's `buildRepeaterFieldGroup`
  // walks the first classification matching the dedupe id, so all
  // sibling sections inherit the same field group binding.
  const seenRepeaterIds = new Set<string>()
  for (const c of classifications) {
    if (c.structure !== 'REPEATER') continue
    const id = `wp_object.${c.page_slug}_${c.item_label}`
    if (seenRepeaterIds.has(id)) continue
    seenRepeaterIds.add(id)
    objects.push({
      id,
      kind:            'repeater',
      on_page_slug:    c.page_slug,
      field_group_ref: `acf.${c.page_slug}_${c.item_label}`,
      rationale:       c.rationale,
      open_questions:  c.open_questions,
      confidence:      c.confidence,
    })
  }

  return objects
}

function displayModeFromPref(pref: string | null): WpObjectExternal['display_mode'] {
  if (pref === 'embed') return 'embed'
  if (pref === 'contact') return 'contact'
  return 'link-out'
}

function buildOptionsPage(inputs: FormationInputs): WpObjectOptionsPage {
  const seeded: string[] = CHURCH_WIDE_GLOBAL_COLUMNS.map(c => c.col)
  const open_questions: string[] = []

  if (inputs.isMultiCampus) {
    // Multi-campus → the 7 campus-scoped columns should NOT be
    // flattened into the Options page. Surface as open question.
    open_questions.push(
      `Multi-${inputs.campusTerm.singular.toLowerCase()} project — these fields are inherently per-${inputs.campusTerm.singular.toLowerCase()} (different value at each ${inputs.campusTerm.singular.toLowerCase()}): ${CAMPUS_SCOPED_COLUMNS.map(c => c.col).join(', ')}. They should NOT be seeded as flat globals. Best modeled as a "${inputs.campusTerm.singular}" CPT or as a per-${inputs.campusTerm.singular.toLowerCase()} repeater on the Visit page.`
    )
  } else {
    seeded.push(...CAMPUS_SCOPED_COLUMNS.map(c => c.col))
  }

  return {
    id:                          'wp_object.global_site',
    kind:                        'options_page',
    slug:                        'global-site',
    menu_title:                  'Global Site Settings',
    capability:                  'manage_options',
    field_group_ref:             'acf.global_site',
    seeded_from_project_columns: seeded,
    open_questions,
    confidence:                  'high',
  }
}

function buildCptFromRoles(
  slug: string,
  classifications: ClassificationRecord[],
  inputs: FormationInputs,
): WpObjectCpt {
  const relevant = classifications.filter(c =>
    c.structure === 'CUSTOM_POST_TYPE' &&
    c.section_role &&
    CPT_SLUG_BY_ROLE[c.section_role] === slug
  )
  const roles = relevant.map(c => c.section_role).filter((r): r is SectionRole => !!r)

  const singleTemplate = inferSingleTemplate(slug, roles, inputs)
  const archive       = inferArchive(slug, roles)
  const headless      =
    !singleTemplate.enabled && !archive.enabled

  const registration: CptRegistrationArgs = {
    public:              !headless,
    publicly_queryable:  !headless,
    has_archive:         archive.enabled,
    show_ui:             true,
    show_in_menu:        true,
    show_in_rest:        true,
    show_in_nav_menus:   !headless,
    exclude_from_search: headless,
    supports:            CPT_SUPPORTS[slug] ?? ['title', 'editor', 'revisions'],
    menu_icon:           CPT_MENU_ICON[slug] ?? null,
    rewrite:             headless ? null : { slug, with_front: false },
  }

  const taxonomies: TaxonomySpec[] = buildTaxonomies(slug, inputs.campusTerm)
  const open_questions = relevant.flatMap(c => c.open_questions)

  // If this slug ALSO maps to a content-collection display_preference
  // kind (events/sermons/groups), surface the partner's answers on
  // the CPT — even when the role-driven path produced it. Otherwise
  // the dev never sees what the partner said about events because
  // event_detail SectionRole shortcuts the display-pref builder.
  const ccKind = contentKindForCptSlug(slug)
  const cca = ccKind ? collectContentCollectionAnswers(ccKind, inputs) : undefined

  return {
    id:                  `wp_object.${slug}`,
    kind:                'custom_post_type',
    slug,
    labels:              cptLabels(slug),
    registration_args:   registration,
    taxonomies,
    single_template:     singleTemplate,
    archive,
    headless,
    external_system:     null,
    external_limits:     null,
    field_group_refs:    [`acf.${slug}`],
    open_questions,
    confidence:          relevant.some(c => c.confidence === 'medium' || c.confidence === 'low')
                          ? 'medium' : 'high',
    _content_collection_answers: cca,
  }
}

/** Reverse lookup: which content-collection kind (events/sermons/
 *  groups) corresponds to a CPT slug. Returns null for slugs that
 *  don't have a content-collection block (staff, post, career). */
function contentKindForCptSlug(slug: string): 'events' | 'sermons' | 'groups' | null {
  if (slug === 'event')  return 'events'
  if (slug === 'sermon') return 'sermons'
  if (slug === 'group')  return 'groups'
  return null
}

/** Surfaces what the display_preference means for the dev — names the
 *  button-target intent across the CPT so McNeel doesn't have to dig
 *  through field_values to figure out where Watch/Register/Contact
 *  buttons point. Returns a one-line summary appended to the CPT's
 *  single_template.rationale. */
function buttonTargetNoteForDisplayPref(
  contentKind: 'events' | 'sermons' | 'groups',
  pref: string | null,
): string {
  if (!pref) return ''
  if (contentKind === 'sermons') {
    switch (pref) {
      case 'latest_sermon':         return 'Buttons on sermon cards link out to the YouTube video. ACF URL field per record holds the YT link.'
      case 'archive_youtube':       return 'Sermons render as cards; each card button links out to YouTube. ACF URL field per record holds the YT link.'
      case 'latest_series_youtube': return 'Latest-series card buttons link out to YouTube. ACF URL field per record holds the YT link.'
      case 'archive_pages':         return 'Sermons render as cards linking to individual on-site detail pages. The card button = CPT permalink (Bricks dynamic-data, no ACF storage). ACF URL field still needed on each record for the embedded video on the detail page.'
      case 'latest_series_pages':   return 'Latest-series cards link to on-site detail pages; card button = CPT permalink. ACF URL field still needed for video embed on detail pages.'
      case 'wordpress':             return 'Legacy "wordpress" value — treated as archive_pages: cards link to on-site detail pages; ACF URL field powers the embed on each.'
    }
  }
  if (contentKind === 'events') {
    switch (pref) {
      case 'wordpress':             return 'Events have on-site detail pages; cards link to CPT permalinks. ACF URL field per record may hold an external registration link (e.g. Church Center) for a secondary CTA.'
    }
  }
  if (contentKind === 'groups') {
    switch (pref) {
      case 'wordpress':             return 'Groups have on-site detail pages; "Learn more" buttons go to CPT permalinks. ACF URL field optional for registration links.'
      case 'contact':               return 'Headless CPT — each group card has a mailto button. ACF Email field per record holds the contact email (no detail page).'
    }
  }
  return ''
}

function buildCptFromDisplayPref(
  slug: string,
  contentKind: 'events' | 'sermons' | 'groups',
  shape: { kind: 'cpt'; single_template: 'yes' | 'no'; archive: 'yes' | 'no'; headless: boolean; rationale: string },
  inputs: FormationInputs,
): WpObjectCpt {
  const singleEnabled  = shape.single_template === 'yes'
  const archiveEnabled = shape.archive === 'yes'
  const headless       = shape.headless

  const registration: CptRegistrationArgs = {
    public:              !headless,
    publicly_queryable:  !headless,
    has_archive:         archiveEnabled,
    show_ui:             true,
    show_in_menu:        true,
    show_in_rest:        true,
    show_in_nav_menus:   !headless,
    exclude_from_search: headless,
    supports:            CPT_SUPPORTS[slug] ?? ['title', 'editor', 'revisions'],
    menu_icon:           CPT_MENU_ICON[slug] ?? null,
    rewrite:             headless ? null : { slug, with_front: false },
  }

  return {
    id:                  `wp_object.${slug}`,
    kind:                'custom_post_type',
    slug,
    labels:              cptLabels(slug),
    registration_args:   registration,
    taxonomies:          buildTaxonomies(slug, inputs.campusTerm),
    single_template: {
      enabled:             singleEnabled,
      brixies_template_id: null,
      cta_target:          contentKind === 'groups' && headless ? 'mailto' : null,
      rationale: (() => {
        const base = shape.rationale
        const note = buttonTargetNoteForDisplayPref(contentKind, inputs.displayPreferences[contentKind])
        if (!note || base.includes(note)) return base
        // Dedup by a substring check on the first 30 chars — covers
        // the legacy 'wordpress' case where shape.rationale already
        // mentions archive_pages.
        const head = note.slice(0, 30)
        if (base.includes(head)) return base
        return `${base} ${note}`
      })(),
    },
    archive: {
      enabled:                       archiveEnabled,
      rendered_via_query_loop_on:    archiveEnabled ? null : `/${contentKind}`,
      rationale:                     shape.rationale,
    },
    headless,
    external_system: null,
    external_limits: null,
    field_group_refs: [`acf.${slug}`],
    open_questions:   [],
    confidence:       'high',
    _content_collection_answers: collectContentCollectionAnswers(contentKind, inputs),
  }
}

/** Picks the relevant content-collection fields for one content kind
 *  and shapes them as { field, label, value } records the dev can
 *  scan. Returns undefined when the session row doesn't exist (no
 *  empty section under the CPT). Empty values are kept so the dev
 *  can see what the partner explicitly DIDN'T answer. */
function collectContentCollectionAnswers(
  contentKind: 'events' | 'sermons' | 'groups',
  inputs: FormationInputs,
): WpObjectCpt['_content_collection_answers'] | undefined {
  const cc = inputs.contentCollection as Record<string, unknown> | null
  if (!cc) return undefined
  const COLUMNS_BY_KIND: Record<typeof contentKind, Array<{ field: string; label: string }>> = {
    events: [
      { field: 'events_display_preference',         label: 'Display preference' },
      { field: 'events_display_format',             label: 'Display format' },
      { field: 'events_external_url',               label: 'External URL (sample / migration source)' },
      { field: 'events_wordpress_source_of_truth',  label: 'Source of truth (current system)' },
      { field: 'events_wordpress_frustration',      label: 'Frustration with current system' },
      { field: 'events_wordpress_recurring_needed', label: 'Recurring events needed?' },
    ],
    sermons: [
      { field: 'sermons_display_preference',        label: 'Display preference' },
      { field: 'sermons_external_url',              label: 'Sermon channel URL' },
      { field: 'sermon_youtube_playlist_exists',    label: 'YouTube playlist exists?' },
      { field: 'sermon_youtube_playlist_url',       label: 'YouTube playlist URL' },
      { field: 'sermon_archive_features',           label: 'Archive features (filters / notes / podcast / etc.)' },
      { field: 'sermon_filters_text',               label: 'Filter notes' },
    ],
    groups: [
      { field: 'groups_display_preference',         label: 'Display preference' },
      { field: 'groups_external_url',               label: 'External URL (sample / migration source)' },
      { field: 'groups_wordpress_source_of_truth',  label: 'Source of truth (current system)' },
      { field: 'groups_wordpress_frustration',      label: 'Frustration with current system' },
    ],
  }
  const fields = COLUMNS_BY_KIND[contentKind].map(({ field, label }) => ({
    field, label, value: cc[field] ?? null,
  }))
  return { content_kind: contentKind, fields }
}

function inferSingleTemplate(
  slug: string,
  roles: SectionRole[],
  _inputs: FormationInputs,
): SingleTemplateSpec {
  // Default: yes if any role in this group has _detail in its name.
  const anyDetailRole = roles.some(r => r.endsWith('_detail'))
  const allListingRoles = roles.every(r =>
    CPT_SINGLE_TEMPLATE_DEFAULT[r] === 'no'
  )
  const enabled = anyDetailRole && !allListingRoles
  return {
    enabled,
    brixies_template_id: null,
    cta_target:          'internal-page',
    rationale: enabled
      ? `CPT \`${slug}\` has detail-section roles in the approved pages — single template needed.`
      : `CPT \`${slug}\` only appears in listing roles in the approved pages — single template disabled, query loop drives the listing instead.`,
  }
}

function inferArchive(_slug: string, roles: SectionRole[]): ArchiveSpec {
  // Heuristic: enable archive only when no role implies the listing
  // lives on a bespoke query-loop page. Conservative: default false
  // and let McNeel toggle on if they want /staff to be a WP archive.
  const allListingRoles = roles.every(r =>
    CPT_SINGLE_TEMPLATE_DEFAULT[r] === 'no'
  )
  if (allListingRoles) {
    return {
      enabled: false,
      rendered_via_query_loop_on: null,
      rationale: 'All section roles for this CPT are listings — render via Bricks query loop on the appropriate page, no WP archive needed.',
    }
  }
  return {
    enabled: false,
    rendered_via_query_loop_on: null,
    rationale: 'Defaulting to no archive — McNeel can toggle on if a stand-alone archive URL is wanted.',
  }
}

function buildTaxonomies(slug: string, campusTerm: CampusTerm): TaxonomySpec[] {
  const suggestions = TAXONOMY_SUGGESTIONS[slug] ?? []
  return suggestions.map(t => ({
    slug: t.slug,
    labels: {
      singular: applyCampusTerm(t.singular, campusTerm),
      plural:   applyCampusTerm(t.plural,   campusTerm),
    },
    hierarchical: t.hierarchical,
    show_in_rest: true,
  }))
}

function applyCampusTerm(label: string, term: CampusTerm): string {
  return label
    .replace('{campus_term_plural}', term.plural)
    .replace('{campus_term}',        term.singular)
}

function cptLabels(slug: string): { singular: string; plural: string } {
  const titles: Record<string, { singular: string; plural: string }> = {
    staff:  { singular: 'Staff Member', plural: 'Staff' },
    event:  { singular: 'Event',        plural: 'Events' },
    sermon: { singular: 'Sermon',       plural: 'Sermons' },
    group:  { singular: 'Group',        plural: 'Groups' },
    career: { singular: 'Career',       plural: 'Careers' },
    post:   { singular: 'Post',         plural: 'Posts' },
  }
  return titles[slug] ?? {
    singular: slug.charAt(0).toUpperCase() + slug.slice(1),
    plural:   slug.charAt(0).toUpperCase() + slug.slice(1) + 's',
  }
}

// ═════════════════════════════════════════════════════════════════════
// PART C — build AcfFieldGroups (ACF JSON Sync compatible)
// ═════════════════════════════════════════════════════════════════════

/** Emits one ACF field group per WpObject that needs ACF fields:
 *
 *  - Options page → one group, location pinned to options_page
 *  - CPT          → one group per CPT, location pinned to post_type
 *  - Repeater     → one group, location pinned to page_template
 *  - External     → no group (content lives elsewhere)
 */
export function buildAcfFieldGroups(
  wpObjects: WpObject[],
  classifications: ClassificationRecord[],
  inputs: FormationInputs,
): AcfFieldGroup[] {
  const groups: AcfFieldGroup[] = []

  for (const obj of wpObjects) {
    if (obj.kind === 'external') continue
    if (obj.kind === 'options_page') {
      groups.push(buildOptionsFieldGroup(obj, inputs))
    } else if (obj.kind === 'custom_post_type') {
      groups.push(buildCptFieldGroup(obj, classifications, inputs))
    } else if (obj.kind === 'repeater') {
      groups.push(buildRepeaterFieldGroup(obj, classifications, inputs))
    }
  }

  return groups
}

function buildOptionsFieldGroup(
  obj: WpObjectOptionsPage,
  inputs: FormationInputs,
): AcfFieldGroup {
  const cols = inputs.isMultiCampus
    ? CHURCH_WIDE_GLOBAL_COLUMNS
    : [...CHURCH_WIDE_GLOBAL_COLUMNS, ...CAMPUS_SCOPED_COLUMNS]

  const fields: AcfField[] = cols.map(c => ({
    key:   `field_global_${c.col}`,
    name:  c.col,
    label: c.label,
    type:  acfTypeForGlobalColumn(c.type),
    _source: {
      web_field_type:     c.type,
      template_field_key: c.col,
    },
  }))

  // Single content row — the project's current global values. Dev's AI
  // assistant uses this to seed the Options page after registration.
  const project = inputs.project as unknown as Record<string, unknown>
  const contentRow: Record<string, unknown> = {}
  for (const c of cols) {
    contentRow[c.col] = project[c.col] ?? null
  }

  return {
    key:      `acf.global_site`,
    title:    `Global Site Settings`,
    fields,
    location: [[{ param: 'options_page', operator: '==', value: obj.slug }]],
    position: 'normal',
    style:    'default',
    _content_rows: [enrichRowWithCtaRoutes(contentRow)],
  }
}

/** Canonical (minimum) field set for a CPT, varied by the partner's
 *  display_preference. Returns [] for CPTs we don't have a canonical
 *  set for (staff / career / post / event). Sermon and group only for
 *  now — that's where the gap was: display-preference-driven CPTs
 *  emitted with only taxonomy fields. */
function canonicalFieldsForCpt(
  slug: string,
  inputs: FormationInputs,
): CanonicalCptField[] {
  if (slug === 'sermon') {
    const shape = sermonCanonicalShape(inputs.displayPreferences.sermons)
    return shape ? CANONICAL_SERMON_FIELDS[shape] : []
  }
  if (slug === 'group') {
    const shape = groupCanonicalShape(inputs.displayPreferences.groups)
    return shape ? CANONICAL_GROUP_FIELDS[shape] : []
  }
  return []
}

function acfTypeForGlobalColumn(t: 'text' | 'richtext' | 'phone' | 'email' | 'url'): AcfField['type'] {
  if (t === 'richtext') return 'wysiwyg'
  if (t === 'url') return 'url'
  if (t === 'email') return 'email'
  // 'phone' and 'text' both map to ACF text (ACF has no native phone)
  return 'text'
}

function buildCptFieldGroup(
  obj: WpObjectCpt,
  classifications: ClassificationRecord[],
  inputs: FormationInputs,
): AcfFieldGroup {
  // For each section that classified as CPT for this slug, walk its
  // template fields and emit one ACF field per WebFieldDef (with
  // sub_fields when it's a group). Dedup by field key — multiple
  // sections of the same role share the same template, so we only
  // emit the field once.
  const seenKeys = new Set<string>()
  const fields: AcfField[] = []
  const sourceSectionIds: string[] = []
  const contentRows: Array<Record<string, unknown>> = []

  for (const c of classifications) {
    if (c.structure !== 'CUSTOM_POST_TYPE') continue
    if (!c.section_role) continue
    if (CPT_SLUG_BY_ROLE[c.section_role] !== obj.slug) continue
    const section = findSection(inputs, c.section_id)
    if (!section?.content_template_id) continue
    const template = inputs.templatesById.get(section.content_template_id)
    if (!template?.fields) continue

    sourceSectionIds.push(section.id)
    for (const def of template.fields) {
      if (seenKeys.has(def.key)) continue
      const acf = webFieldDefToAcfField(def, `field_${obj.slug}_${def.key}`)
      if (acf) {
        seenKeys.add(def.key)
        fields.push(acf)
      }
    }

    // Extract per-record content from this section. CPTs typically
    // surface their records as items inside a group field on a
    // listing-style section. Brixies templates often double-nest
    // (`row_grid` > `card_team` > individual staff items), so we
    // recurse into nested groups and only emit a row at the LEAF
    // (the innermost group whose items don't contain another group).
    const fv = (section.field_values as Record<string, unknown> | null) ?? {}
    for (const def of template.fields) {
      if (def.kind !== 'group') continue
      const arr = fv[def.key]
      if (!Array.isArray(arr)) continue
      for (const item of arr) {
        contentRows.push(...extractCptRecordsFromGroup(item, def))
      }
    }
    // If the section is a detail-page section (no group), the section
    // ITSELF is one record's worth of content — flatten the slot
    // values directly.
    if (!template.fields.some(d => d.kind === 'group')) {
      const row: Record<string, unknown> = {}
      for (const def of template.fields) {
        if (def.kind === 'slot') {
          row[def.key] = fv[def.key] ?? null
        }
      }
      if (Object.keys(row).length > 0) contentRows.push(row)
    }
  }

  // Seed canonical fields for sermon / group CPTs that were emitted
  // from the partner's display_preference and have no tagged sections
  // backing them (so `fields` is empty above). Without this, the dev
  // gets a CPT with only taxonomy fields, which can't hold any real
  // sermon or group data. Honors the partner's display_preference
  // (e.g. archive_pages adds notes_url + audio_url; the contact group
  // flavor requires contact_email).
  //
  // We also append canonical fields when the source sections exist
  // but missed columns the canonical set declares — the canonical set
  // is the minimum WP shape, not a fallback.
  const canonical = canonicalFieldsForCpt(obj.slug, inputs)
  for (const cf of canonical) {
    if (seenKeys.has(cf.name)) continue
    seenKeys.add(cf.name)
    fields.push({
      key:          `field_${obj.slug}_${cf.name}`,
      name:         cf.name,
      label:        cf.label,
      type:         cf.type,
      required:     cf.required,
      instructions: cf.description,
    })
  }

  // Append taxonomy fields for filterable surfaces
  for (const tax of obj.taxonomies) {
    const key = `field_${obj.slug}_${tax.slug}`
    if (seenKeys.has(tax.slug)) continue
    fields.push({
      key,
      name:     tax.slug,
      label:    tax.labels.singular,
      type:     'taxonomy',
      taxonomy: tax.slug,
    })
    seenKeys.add(tax.slug)
  }

  const enrichedRows = dedupContentRows(contentRows).map(enrichRowWithCtaRoutes)
  // Route-driven ACF type refinement: walk fields, look at the
  // aggregate of route_types per field name, promote to the better
  // ACF type when a dominant destination exists.
  const routeByName = aggregateCtaRoutesByFieldName(enrichedRows)
  refineCtaFieldsWithRouteAnalysis(fields, routeByName)

  return {
    key:      `acf.${obj.slug}`,
    title:    `${obj.labels.singular} fields`,
    fields,
    location: [[{ param: 'post_type', operator: '==', value: obj.slug }]],
    position: 'normal',
    style:    'default',
    _source_section_ids: sourceSectionIds,
    _content_rows: enrichedRows,
  }
}

/** Recursively pull leaf records out of a nested group. Brixies
 *  templates often double-nest (`row_grid` > `card_team` > items);
 *  only the LEAF level is where actual content lives. When an item
 *  carries a nested group's array, recurse into that array — only
 *  emit a record when the item itself is a leaf (no nested groups
 *  with array values). */
function extractCptRecordsFromGroup(item: unknown, group: WebGroupDef): Array<Record<string, unknown>> {
  if (item == null || typeof item !== 'object' || Array.isArray(item)) return []
  const obj = item as Record<string, unknown>
  const out: Array<Record<string, unknown>> = []
  const nestedGroups = (Array.isArray(group.item_schema) ? group.item_schema : [])
    .filter((f): f is WebGroupDef => f.kind === 'group')
  for (const ng of nestedGroups) {
    const nested = obj[ng.key]
    if (Array.isArray(nested)) {
      for (const nItem of nested) out.push(...extractCptRecordsFromGroup(nItem, ng))
    }
  }
  // If recursion produced records, return those — the current item
  // is a container, not a leaf. Only emit the current item as a
  // record when no nested group expanded into anything.
  if (out.length > 0) return out
  const leaf = flattenItemForCpt(item, group)
  return leaf ? [leaf] : []
}

/** Reshape one item of a group's array into a content row aligned
 *  with the CPT's flat field set. Walks nested objects shallowly so
 *  e.g. `{ contact: { label, url } }` collapses to keys we can read.
 *  Drops empty values and Brixies bracket placeholders. */
function flattenItemForCpt(item: unknown, def: WebFieldDef): Record<string, unknown> | null {
  if (item == null || typeof item !== 'object' || Array.isArray(item)) return null
  const obj = item as Record<string, unknown>
  const row: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (looksEmpty(v)) continue
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      // Shallow flatten one level — e.g. CTA { label, url } collapses
      // to cta_label / cta_url keys for spreadsheet-friendly export.
      for (const [sk, sv] of Object.entries(v as Record<string, unknown>)) {
        if (looksEmpty(sv)) continue
        row[`${k}_${sk}`] = sv
      }
    } else {
      row[k] = v
    }
  }
  // Tag with the source template field key so dev knows which group
  // produced this row.
  row._source_group = def.key
  return row
}

// ── CTA route classification ────────────────────────────────────────
//
// McNeel needs to know the destination type for every button/CTA we
// extract, not just "there's a CTA here." A sermon button to YouTube
// is a different build problem from a careers button to a PDF.

export type CtaRouteType =
  | 'internal-page'      // /sermons, /staff, etc.
  | 'internal-anchor'    // #section on same page
  | 'youtube'            // youtube.com, youtu.be
  | 'vimeo'              // vimeo.com
  | 'church-center'      // churchcenter.com / planningcenter / CCB
  | 'social'             // facebook, instagram, tiktok, twitter, linkedin
  | 'file'               // .pdf, .doc, .docx, .xls, .ppt, .zip, etc.
  | 'form'               // /apply, /form, /register, /signup pages
  | 'mailto'
  | 'tel'
  | 'external'           // any other https:// destination
  | 'unset'              // empty / missing URL

interface CtaRoute {
  field: string                // dotted path: e.g. "buttons.contact_url"
  url:   string
  route_type: CtaRouteType
  hint: string                 // human label: "YouTube channel", ".pdf download", "/staff page", etc.
}

function classifyCtaRoute(url: string | null | undefined): { type: CtaRouteType; hint: string } {
  if (!url || typeof url !== 'string') return { type: 'unset', hint: 'no URL' }
  const u = url.trim()
  if (!u) return { type: 'unset', hint: 'empty' }
  if (u.startsWith('mailto:'))    return { type: 'mailto', hint: u.replace(/^mailto:/, '') }
  if (u.startsWith('tel:'))       return { type: 'tel', hint: u.replace(/^tel:/, '') }
  if (u.startsWith('#'))          return { type: 'internal-anchor', hint: u }
  if (u.startsWith('/'))          return { type: 'internal-page', hint: u }
  const lower = u.toLowerCase()
  if (/(youtube\.com|youtu\.be)/.test(lower))             return { type: 'youtube', hint: 'YouTube video / channel' }
  if (/vimeo\.com/.test(lower))                           return { type: 'vimeo', hint: 'Vimeo' }
  if (/churchcenter\.com|planningcenter/.test(lower))     return { type: 'church-center', hint: 'Church Center / Planning Center' }
  if (/ccbchurch|churchcommunitybuilder/.test(lower))     return { type: 'church-center', hint: 'Church Community Builder' }
  if (/facebook\.com|instagram\.com|tiktok\.com|twitter\.com|x\.com|linkedin\.com/.test(lower)) {
    return { type: 'social', hint: 'social profile / post' }
  }
  const fileMatch = lower.match(/\.([a-z0-9]{2,5})(\?|#|$)/)
  if (fileMatch && /^(pdf|docx?|xlsx?|pptx?|zip|jpe?g|png|mp4|mov|csv)$/.test(fileMatch[1])) {
    return { type: 'file', hint: `.${fileMatch[1]} download` }
  }
  if (/\/(apply|application|form|register|signup|sign-up|join|interest|onboard)/.test(lower)) {
    return { type: 'form', hint: 'application / signup form' }
  }
  return { type: 'external', hint: 'external page' }
}

/** Maps a strategist-tagged CtaKind (from CtaValue.kind on a CTA
 *  field) to the analyzer's CtaRouteType. The strategist-set kind is
 *  the AUTHORITATIVE signal — when present, it overrides anything we
 *  would derive from URL inspection. */
function routeTypeFromCtaKind(kind: string): { type: CtaRouteType; hint: string } | null {
  switch (kind) {
    case 'internal_route':   return { type: 'internal-page',   hint: 'strategist tagged: internal page' }
    case 'external_url':     return { type: 'external',        hint: 'strategist tagged: external page' }
    case 'anchor':           return { type: 'internal-anchor', hint: 'strategist tagged: page anchor' }
    case 'mailto':           return { type: 'mailto',          hint: 'strategist tagged: email' }
    case 'tel':              return { type: 'tel',             hint: 'strategist tagged: phone' }
    case 'snippet':          return { type: 'external',        hint: 'strategist tagged: site snippet' }
    case 'file_download':    return { type: 'file',            hint: 'strategist tagged: file download' }
    case 'video_link':       return { type: 'youtube',         hint: 'strategist tagged: video link' }
    case 'application_form': return { type: 'form',            hint: 'strategist tagged: application/signup form' }
    default: return null
  }
}

/** Walk a content row and emit one CtaRoute per URL field found.
 *  Recognises both the flattened pattern (`contact_url`,
 *  `cta_url`, `learn_more_url`) and bare `url` keys nested inside
 *  named groups. Prefers CtaValue.kind (strategist's explicit choice)
 *  over URL pattern inspection when both are present. */
function extractCtaRoutes(row: Record<string, unknown>, prefix = ''): CtaRoute[] {
  const out: CtaRoute[] = []
  for (const [k, v] of Object.entries(row)) {
    if (k.startsWith('_')) continue            // internal markers
    const path = prefix ? `${prefix}.${k}` : k
    // Strategist-set CtaValue { label, url, kind } — kind is the
    // authoritative source. Detect and bypass URL inspection.
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const obj = v as Record<string, unknown>
      if (typeof obj.kind === 'string' && typeof obj.url === 'string') {
        const fromKind = routeTypeFromCtaKind(obj.kind)
        if (fromKind && obj.url.trim()) {
          out.push({ field: `${path}.url`, url: obj.url, route_type: fromKind.type, hint: fromKind.hint })
          continue
        }
      }
      out.push(...extractCtaRoutes(obj, path))
      continue
    }
    if (typeof v === 'string') {
      // *_url, bare `url`, or any string field whose value looks like
      // a URL — be conservative to avoid catching arbitrary text.
      const isUrlField = k.endsWith('_url') || k === 'url'
      if (isUrlField || /^(https?:|mailto:|tel:|#|\/)/i.test(v)) {
        const r = classifyCtaRoute(v)
        if (r.type !== 'unset') out.push({ field: path, url: v, route_type: r.type, hint: r.hint })
      }
    } else if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (item && typeof item === 'object' && !Array.isArray(item)) {
          out.push(...extractCtaRoutes(item as Record<string, unknown>, `${path}[${i}]`))
        }
      })
    }
  }
  return out
}

/** Attach an `_cta_routes` array to a content row when any CTA
 *  destinations are detected inside it. Caller decides whether to
 *  include this in the public output (we always do — McNeel needs
 *  the routing info per-record). */
function enrichRowWithCtaRoutes(row: Record<string, unknown>): Record<string, unknown> {
  const routes = extractCtaRoutes(row)
  if (routes.length === 0) return row
  return { ...row, _cta_routes: routes }
}

/** Aggregate route_types per field-name across all content rows.
 *  Used by the field-tree refinement pass to recommend a better ACF
 *  field type when a button consistently targets one destination
 *  (e.g. careers always → PDF file, sermons always → YouTube). */
function aggregateCtaRoutesByFieldName(rows: Array<Record<string, unknown>>): Map<string, Map<CtaRouteType, number>> {
  const out = new Map<string, Map<CtaRouteType, number>>()
  for (const row of rows) {
    const ctas = row._cta_routes as CtaRoute[] | undefined
    if (!Array.isArray(ctas)) continue
    for (const c of ctas) {
      // Take the LAST path segment and strip `_url` suffix so e.g.
      // `buttons[0].contact_url` → `contact`, matching the ACF
      // field's name on the group. Flatten/bare URLs (`social_facebook_url`)
      // keep their full name as the key, so the analyzer can still
      // surface them.
      const lastSeg = c.field.split(/[.\[\]]/).filter(Boolean).pop() ?? c.field
      const key = lastSeg.endsWith('_url') ? lastSeg.replace(/_url$/, '') : lastSeg
      const inner = out.get(key) ?? new Map<CtaRouteType, number>()
      inner.set(c.route_type, (inner.get(c.route_type) ?? 0) + 1)
      out.set(key, inner)
      // Also store under the full `_url` form so url-typed fields
      // (not just group/cta) can be matched.
      if (lastSeg !== key) {
        const innerFull = out.get(lastSeg) ?? new Map<CtaRouteType, number>()
        innerFull.set(c.route_type, (innerFull.get(c.route_type) ?? 0) + 1)
        out.set(lastSeg, innerFull)
      }
    }
  }
  return out
}

interface AcfTypeRecommendation { recommended_acf_type: AcfFieldType; reason: string }

/** Promotion-eligible ACF types — these are the ONLY ACF types we
 *  upgrade a generic URL field to. Why this is narrower than it might
 *  look:
 *
 *  - `file`   — editor uploads instead of pasting URLs; large
 *               behavioral change worth promoting when observed.
 *  - `email`  — mailto destinations want a dedicated email field
 *               (validation + UI).
 *  - `text` (for tel:) — ACF has no native phone field; text + a
 *               "tel:..." placeholder is the closest dev gets.
 *
 *  Cases we DO NOT promote (kept as ACF `url` with a note):
 *
 *  - YouTube/Vimeo — observed YT URLs at the field-values level
 *    might just be Brixies template defaults. Whether the button
 *    links out to YT vs renders as an oembed depends on the
 *    partner's sermons_display_preference (we surface that signal
 *    in the CPT's single_template.rationale, separately).
 *  - internal-page — typically rendered via Bricks dynamic-data
 *    from the CPT permalink, not stored as a URL. Promoting to
 *    ACF page_link forces editors to pick from a dropdown when
 *    the value is auto-derived.
 *  - social / external / form / church-center / internal-anchor —
 *    URL is correct; no behavioral upgrade available.
 */
const PROMOTABLE_TO: ReadonlySet<AcfFieldType> = new Set(['file', 'email', 'text'])

/** Maps the dominant route to the best ACF field type. Threshold:
 *  90% of records must share the route for us to promote — anything
 *  below that and the field stays a generic URL with a notation
 *  about the mix. */
function recommendAcfTypeFromRoutes(stats: Map<CtaRouteType, number>): AcfTypeRecommendation | null {
  const entries = [...stats.entries()].sort((a, b) => b[1] - a[1])
  if (entries.length === 0) return null
  const total = entries.reduce((sum, [, n]) => sum + n, 0)
  const [top, topCount] = entries[0]
  const ratio = topCount / total
  if (ratio < 0.9) {
    const breakdown = entries.map(([r, n]) => `${n} ${r}`).join(', ')
    return {
      recommended_acf_type: 'url',
      reason: `mixed destinations (${breakdown}) — keep as ACF URL field, dev manually validates per record`,
    }
  }
  switch (top) {
    case 'file':
      return { recommended_acf_type: 'file',  reason: `${topCount}/${total} records link to file downloads (PDF/doc/etc.) — use ACF File field so editors upload assets instead of pasting URLs` }
    case 'mailto':
      return { recommended_acf_type: 'email', reason: `${topCount}/${total} records are email addresses — use ACF Email field` }
    case 'tel':
      return { recommended_acf_type: 'text',  reason: `${topCount}/${total} records are phone numbers (tel:) — ACF has no native phone type, use Text with a "tel:..." placeholder` }
    case 'youtube':
    case 'vimeo':
      // Don't promote. Bricks template determines whether this URL
      // renders as a "Watch" button or an auto-embed widget — both
      // resolve from an ACF URL field. The partner's display_preference
      // (sermons_display_preference) is the authoritative signal for
      // which mode is in use; we surface that on the CPT itself.
      return { recommended_acf_type: 'url',   reason: `${topCount}/${total} records are ${top} URLs — keep ACF URL field. Whether this renders as a link or auto-embed is decided by the partner's display_preference (see the CPT's single_template.rationale).` }
    case 'internal-page':
      return { recommended_acf_type: 'url',   reason: `${topCount}/${total} records target internal pages — keep ACF URL field. Bricks dynamic-data resolves CPT permalinks at render; no need for ACF page_link picker.` }
    case 'social':
    case 'external':
    case 'form':
    case 'church-center':
      return { recommended_acf_type: 'url',   reason: `${topCount}/${total} records are ${top} URLs — ACF URL field is correct` }
    case 'internal-anchor':
      return { recommended_acf_type: 'url',   reason: `${topCount}/${total} records are page anchors (#section) — keep ACF URL` }
    default:
      return null
  }
}

/** Walks the ACF field tree and applies route-driven recommendations
 *  to any field that's CTA-shaped. Promotes ONLY to types in
 *  PROMOTABLE_TO (file / email / text-for-tel). Everything else
 *  stays ACF `url` with explanatory notes — for cases like YouTube
 *  or internal-page, the right ACF storage is still URL; the
 *  behavioral difference is downstream (Bricks template / display
 *  preference).
 *
 *  Records the analysis on every CTA-shaped field even when no
 *  promotion happens, so the translator can show the dev what the
 *  destinations look like + flag any open questions for the
 *  strategist. */
function refineCtaFieldsWithRouteAnalysis(
  fields: AcfField[],
  byName: Map<string, Map<CtaRouteType, number>>,
): void {
  for (const f of fields) {
    const stats = byName.get(f.name)
    if (stats) {
      const rec = recommendAcfTypeFromRoutes(stats)
      if (rec) {
        const isCtaShaped =
          (f.type === 'group' && Array.isArray(f.sub_fields) &&
           f.sub_fields.some(sf => sf.type === 'url') &&
           f.sub_fields.some(sf => sf.type === 'text')) ||
          f.type === 'url'
        const willPromote =
          isCtaShaped &&
          PROMOTABLE_TO.has(rec.recommended_acf_type) &&
          rec.recommended_acf_type !== f.type
        f._cta_analysis = {
          total_records:        [...stats.values()].reduce((a, b) => a + b, 0),
          by_route_type:        Object.fromEntries(stats),
          recommended_acf_type: rec.recommended_acf_type,
          reason:               rec.reason,
          type_promoted:        willPromote,
        }
        if (willPromote) {
          f.type = rec.recommended_acf_type
          // file / email are scalar — drop the {label, url} sub-fields.
          // text (for tel) keeps no sub_fields by default anyway.
          f.sub_fields = undefined
        }
      }
    }
    if (Array.isArray(f.sub_fields)) refineCtaFieldsWithRouteAnalysis(f.sub_fields, byName)
  }
}

function looksEmpty(v: unknown): boolean {
  if (v == null) return true
  if (typeof v === 'string') {
    const t = v.trim()
    return t.length === 0 || /^\[(NEEDS INPUT|TODO|PLACEHOLDER):/i.test(t)
  }
  if (Array.isArray(v)) return v.length === 0
  return false
}

/** Dedup CPT content rows by their JSON-stringified payload (minus
 *  the _source_group tag). Same staff member listed on two pages
 *  shouldn't produce two post records. */
function dedupContentRows(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const seen = new Set<string>()
  const out: Array<Record<string, unknown>> = []
  for (const r of rows) {
    const { _source_group: _g, ...rest } = r
    const key = JSON.stringify(rest)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(r)
  }
  return out
}

function buildRepeaterFieldGroup(
  obj: WpObjectRepeater,
  classifications: ClassificationRecord[],
  inputs: FormationInputs,
): AcfFieldGroup {
  const c = classifications.find(c => `acf.${c.page_slug}_${c.item_label}` === obj.field_group_ref)
  let fields: AcfField[] = []
  let sourceSectionIds: string[] = []
  const contentRows: Array<Record<string, unknown>> = []
  if (c) {
    const section = findSection(inputs, c.section_id)
    if (section?.content_template_id) {
      const template = inputs.templatesById.get(section.content_template_id)
      const def = template?.fields.find(d => d.key === c.item_label)
      if (def) {
        const acf = webFieldDefToAcfField(def, `field_${c.page_slug}_${def.key}`)
        if (acf) fields = [acf]
        // Pull the actual filled items array from field_values so dev
        // can populate the repeater rows right after WP setup.
        if (def.kind === 'group') {
          const fv = (section.field_values as Record<string, unknown> | null) ?? {}
          const arr = fv[def.key]
          if (Array.isArray(arr)) {
            for (const item of arr) {
              const row = flattenItemForCpt(item, def)
              if (row && Object.keys(row).length > 0) {
                // drop the source-group tag for repeaters (it's
                // redundant — the field group itself names the group)
                const { _source_group: _g, ...rest } = row
                contentRows.push(rest)
              }
            }
          }
        }
      }
    }
    if (section) sourceSectionIds = [section.id]
  }

  // Repeater field-group location: page_template pinning. We use the
  // page slug as the template name — dev maps this to the actual
  // page template at WP-side.
  const location: AcfLocationRule[][] = [[
    { param: 'page_template', operator: '==', value: `page-${obj.on_page_slug}.php` },
  ]]

  const enrichedRows = contentRows.map(enrichRowWithCtaRoutes)
  const routeByName = aggregateCtaRoutesByFieldName(enrichedRows)
  refineCtaFieldsWithRouteAnalysis(fields, routeByName)

  return {
    key:      obj.field_group_ref.replace(/^acf\./, 'acf.repeater_'),
    title:    `Repeater: ${obj.on_page_slug} / ${c?.item_label ?? ''}`,
    fields,
    location,
    position: 'normal',
    style:    'default',
    _source_section_ids: sourceSectionIds,
    _content_rows: enrichedRows,
  }
}

// ── WebFieldDef → AcfField conversion ────────────────────────────────

function webFieldDefToAcfField(def: WebFieldDef, keyPrefix: string): AcfField | null {
  if (def.kind === 'group') {
    return webGroupToRepeater(def, keyPrefix)
  }
  return webSlotToAcfField(def, keyPrefix)
}

function webSlotToAcfField(slot: WebSlotDef, key: string): AcfField | null {
  if (slot.type === 'form-input') return null  // handled by Bricks
  if (slot.type === 'cta') {
    return {
      key,
      name:  slot.key,
      label: slot.label ?? humanize(slot.key),
      type:  'group',
      sub_fields: [
        { key: `${key}_label`, name: 'label', label: 'Label', type: 'text' },
        { key: `${key}_url`,   name: 'url',   label: 'URL',   type: 'url'  },
      ],
      _source: { web_field_type: slot.type, template_field_key: slot.key },
    }
  }
  const acfType = ACF_TYPE_BY_FIELD_TYPE[slot.type]
  if (!acfType) return null
  return {
    key,
    name:  slot.key,
    label: slot.label ?? humanize(slot.key),
    type:  acfType,
    required: slot.required ?? undefined,
    _source: { web_field_type: slot.type, template_field_key: slot.key },
  }
}

function webGroupToRepeater(group: WebGroupDef, key: string): AcfField {
  // Some templates ship a WebGroupDef without an item_schema (the
  // schema parser couldn't infer the item shape, or it's a
  // referenced-template group like card_palette which has no inline
  // sub-fields). Defend against the null/undefined case so the
  // analyzer doesn't crash on those rows.
  const itemSchema = Array.isArray(group.item_schema) ? group.item_schema : []
  const subFields: AcfField[] = []
  for (const sub of itemSchema) {
    const subKey = `${key}__${sub.key}`
    const acf = webFieldDefToAcfField(sub, subKey)
    if (acf) subFields.push(acf)
  }
  return {
    key,
    name:        group.key,
    label:       humanize(group.key),
    type:        'repeater',
    sub_fields:  subFields,
  }
}

function humanize(s: string): string {
  return s
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
}

function findSection(inputs: FormationInputs, sectionId: string): WebSection | null {
  for (const sections of inputs.sectionsByPage.values()) {
    const found = sections.find(s => s.id === sectionId)
    if (found) return found
  }
  return null
}

// ═════════════════════════════════════════════════════════════════════
// PART D bis — Section discovery summaries
// ═════════════════════════════════════════════════════════════════════
//
// One DiscoverySection per approved section (excluding chrome). Carries
// the section's heading, item count, schema, sample names, and a
// target hint so the dev handoff can show "what's here" grouped by
// section (not just by suggested CPT). The strategist's mental model
// is per-section: "Pastors" and "Ministry Leaders" are both staff-
// shaped but with different schemas + targets, and they want to see
// both broken out.

import type { DiscoverySection } from './types'
import { classifySchema } from './classifySchema'

/** True when every key on the item ends in a CTA-flattening suffix
 *  (_label/_url/_kind/_target). Such items are the rows of a button/
 *  CTA list, not content cards — they don't carry a schema. */
function isCtaOnlyItem(item: Record<string, unknown>): boolean {
  const keys = Object.keys(item)
  if (keys.length === 0) return false
  return keys.every(k =>
    k.endsWith('_label') || k.endsWith('_url') ||
    k.endsWith('_kind')  || k.endsWith('_target')
  )
}

/** Section roles where a 1-item section is just decorative chrome
 *  (page hero, intro paragraph, single-CTA banner) — not something
 *  the dev needs to model. Filtered out of the discovery view so the
 *  doc focuses on dev-relevant work (feature/team/event/sermon/blog/
 *  group/career sections with real items to build against). Multi-
 *  item sections of the same role STAY (e.g. a feature_split with
 *  4 items is dev-relevant). */
const TRIVIAL_ROLES_WHEN_SINGLE = new Set<SectionRole>([
  'hero_home', 'hero_innerpage', 'hero_visual',
  'banner_announcement',
  'intro_text', 'content_block',
  'mission_statement', 'verse_callout',
  'cta_banner_simple', 'cta_banner_split', 'cta_full_bleed',
  'feature_split',
])

export function buildDiscoverySections(
  inputs: FormationInputs,
  classifications: ClassificationRecord[],
): DiscoverySection[] {
  const out: DiscoverySection[] = []
  for (const page of inputs.approvedPages) {
    const sections = inputs.sectionsByPage.get(page.id) ?? []
    for (const section of sections) {
      // Skip chrome (header/footer/etc.) — they're not editable content.
      if (section.section_role && CHROME_ROLES.has(section.section_role)) continue
      const template = section.content_template_id
        ? inputs.templatesById.get(section.content_template_id) ?? null
        : null
      if (!template?.fields) continue
      const fv = (section.field_values as Record<string, unknown> | null) ?? {}

      const heading = headingForSection(section, template, fv)
      const { count, schema, sampleNames, sampleRecord, projectedItems } = analyzeSectionItems(template, fv, inputs.templatesById)

      // Filter: skip trivial single-item sections (heros / intros /
      // single-CTA banners) unless the strategist explicitly tagged
      // the section as dev-relevant via strategist_target_type.
      const isTrivial =
        count <= 1 &&
        section.section_role !== null &&
        TRIVIAL_ROLES_WHEN_SINGLE.has(section.section_role) &&
        !section.strategist_target_type
      if (isTrivial) continue

      // Filter: skip sections whose primary group is a button/CTA list
      // (every projected-item key ends in _label/_url/_kind/_target).
      // The "items" here are action buttons under a single copy block,
      // not repeating content cards — they don't carry a schema worth
      // diagnosing. Caught here rather than in analyzeSectionItems so
      // the analyzer stays a pure function.
      if (projectedItems.length > 0 && projectedItems.every(isCtaOnlyItem) && !section.strategist_target_type) {
        continue
      }

      // Target hint: strategist annotation wins; else inferred.
      const annotated = section.strategist_target_type as DiscoverySection['target_hint'] | null | undefined
      const targetHint: DiscoverySection['target_hint'] = annotated
        ? annotated
        : inferTargetHint(section.section_role, inputs, classifications)

      const cptRef = classifications
        .find(c => c.section_id === section.id && c.cpt_subroutine_ref)
        ?.cpt_subroutine_ref ?? null

      // Partner context: if this section maps to a content-collection
      // kind (events / sermons / groups), attach the partner's
      // display_preference + supporting answers so the dev knows
      // what the section should DO without having to look it up.
      const partnerContext = derivePartnerContext(section.section_role, cptRef, inputs)

      // Content diagnosis (v1.5): classify against canonical schema
      // vocabulary, compute field fill rates + CTA breakdown + library
      // coverage gaps. Skip when there are no repeating items — single
      // copy blocks don't get a schema_name (already filtered above
      // when the section is also TRIVIAL_ROLES_WHEN_SINGLE, but
      // sometimes 1-item sections survive that filter).
      const diagnosis = projectedItems.length > 0
        ? classifySchema({
            page_slug:           page.slug,
            heading,
            section_role:        section.section_role,
            items:               projectedItems,
            template_field_keys: schema,
            template_id:         section.content_template_id ?? '(unknown)',
            cpt_subroutine_ref:  cptRef,
          })
        : null

      out.push({
        section_id:        section.id,
        web_page_id:       section.web_page_id,
        page_slug:         page.slug,
        page_name:         page.name ?? page.slug,
        heading,
        section_role:      section.section_role,
        item_count:        count,
        schema,
        sample_names:      sampleNames,
        sample_record:     sampleRecord,
        target_hint:       targetHint,
        cpt_subroutine_ref: cptRef,
        ...(partnerContext ? { partner_context: partnerContext } : {}),
        ...(diagnosis ? {
          schema_name:              diagnosis.schema_name,
          schema_confidence:        diagnosis.schema_confidence,
          schema_field_diagnostics: diagnosis.schema_field_diagnostics,
          cta_target_breakdown:     diagnosis.cta_target_breakdown,
          build_time_issues:        diagnosis.build_time_issues,
        } : {}),
      })
    }
  }
  return out
}

/** Map a section's role / CPT routing to its content-collection kind,
 *  then pull the partner's answers from the cached session row. Null
 *  when the section isn't event/sermon/group flavored. */
function derivePartnerContext(
  role: SectionRole | null,
  cptRef: string | null,
  inputs: FormationInputs,
): DiscoverySection['partner_context'] | null {
  const cc = inputs.contentCollection as Record<string, unknown> | null
  if (!cc) return null
  let kind: 'events' | 'sermons' | 'groups' | null = null
  if (cptRef === 'wp_object.event'  || role === 'event_detail')                    kind = 'events'
  if (cptRef === 'wp_object.sermon' || (role && /sermon/i.test(role)))             kind = 'sermons'
  if (cptRef === 'wp_object.group'  || (role && /group/i.test(role)))              kind = 'groups'
  if (!kind) return null

  if (kind === 'events') {
    return {
      content_kind:       'events',
      display_preference: (cc.events_display_preference as string | null) ?? null,
      display_format:     (cc.events_display_format as string | null) ?? null,
      external_url:       (cc.events_external_url as string | null) ?? null,
      source_of_truth:    (cc.events_wordpress_source_of_truth as string | null) ?? null,
      frustration:        (cc.events_wordpress_frustration as string | null) ?? null,
    }
  }
  if (kind === 'sermons') {
    return {
      content_kind:       'sermons',
      display_preference: (cc.sermons_display_preference as string | null) ?? null,
      external_url:       (cc.sermons_external_url as string | null) ?? null,
      playlist_url:       (cc.sermon_youtube_playlist_url as string | null) ?? null,
      archive_features:   Array.isArray(cc.sermon_archive_features) ? cc.sermon_archive_features as string[] : null,
    }
  }
  // groups
  return {
    content_kind:       'groups',
    display_preference: (cc.groups_display_preference as string | null) ?? null,
    external_url:       (cc.groups_external_url as string | null) ?? null,
    source_of_truth:    (cc.groups_wordpress_source_of_truth as string | null) ?? null,
    frustration:        (cc.groups_wordpress_frustration as string | null) ?? null,
  }
}

function headingForSection(
  section: WebSection,
  template: WebContentTemplate,
  fv: Record<string, unknown>,
): string {
  for (const key of ['primary_heading', 'heading', 'title']) {
    const v = fv[key]
    if (typeof v === 'string' && v.trim()) return v.trim().replace(/<[^>]+>/g, '').slice(0, 120)
  }
  const cw = section.cowork_slot_values as Record<string, unknown> | null
  if (cw) {
    for (const key of ['primary_heading', 'heading']) {
      const v = cw[key]
      if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 120)
    }
  }
  if (section.section_role_label?.trim()) return section.section_role_label.trim()
  return template.layer_name ?? '(unnamed section)'
}

function analyzeSectionItems(
  template: WebContentTemplate,
  fv: Record<string, unknown>,
  templatesById: Map<string, WebContentTemplate>,
): {
  count: number
  schema: string[]
  sampleNames: string[]
  sampleRecord: Record<string, unknown> | null
  /** Full items array projected onto schema. Used by the classifier
   *  (classifySchema) to compute fill rates + CTA breakdown + library
   *  coverage gaps. */
  projectedItems: Record<string, unknown>[]
} {
  // Find the section's primary group field — the one whose items
  // array drives the section's "what's here" view. Heuristic: first
  // group whose array isn't empty. Recurse one level into nested
  // groups (row_grid > card_team pattern) so we land on real items.
  for (const def of template.fields) {
    if (def.kind !== 'group') continue
    const arr = fv[def.key]
    if (!Array.isArray(arr) || arr.length === 0) continue
    const { items, schemaFromGroup } = drillToLeafItems(def, arr, templatesById)
    if (items.length === 0) continue
    const projectedItems = items.map(it => projectItemOntoSchema(it, schemaFromGroup))
    // sample_record = first leaf item, projected onto the schema so
    // every schema field shows up even if the partner left it blank.
    return {
      count:          items.length,
      schema:         schemaFromGroup,
      sampleNames:    items.slice(0, 3).map(itemSummary).filter(Boolean) as string[],
      sampleRecord:   projectedItems[0] ?? null,
      projectedItems,
    }
  }
  // No group field — treat the section itself as a single record.
  const topSchema = template.fields
    .filter(d => d.kind === 'slot')
    .map(d => d.key)
    .filter(k => fv[k] != null && String(fv[k]).trim() !== '')
  // Project the section's field_values onto the slot schema. This
  // works for hero/intro/content_block sections that have meaningful
  // heading + body + button content the dev needs to see.
  const sampleRecord = topSchema.length > 0
    ? projectItemOntoSchema(fv, topSchema)
    : null
  return {
    count:          1,
    schema:         topSchema,
    sampleNames:    [],
    sampleRecord,
    projectedItems: sampleRecord ? [sampleRecord] : [],
  }
}

/** Project an item onto a schema, flattening nested {label,url} CTAs
 *  and {kind,target} adornments into top-level keys so a dev reading
 *  the sample doesn't have to mentally walk nested structure. */
function projectItemOntoSchema(item: unknown, schema: string[]): Record<string, unknown> {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return {}
  const src = item as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const key of schema) {
    const v = src[key]
    if (v == null) {
      out[key] = null
      continue
    }
    if (typeof v === 'object' && !Array.isArray(v)) {
      // Nested object — flatten sensibly. CTAs commonly look like
      // { label, url, kind, target } — pull these out as suffixed
      // siblings so each shows up in the sample as its own line.
      const nested = v as Record<string, unknown>
      if (typeof nested.url === 'string' || typeof nested.label === 'string') {
        if (typeof nested.label === 'string' && nested.label) out[`${key}_label`] = nested.label
        if (typeof nested.url   === 'string' && nested.url)   out[`${key}_url`]   = nested.url
        if (typeof nested.kind  === 'string')                  out[`${key}_kind`]  = nested.kind
        continue
      }
      // Generic object — keep as-is; render layer truncates JSON.
      out[key] = v
      continue
    }
    out[key] = v
  }
  return out
}

function drillToLeafItems(
  group: WebGroupDef,
  arr: unknown[],
  templatesById: Map<string, WebContentTemplate>,
): { items: Record<string, unknown>[]; schemaFromGroup: string[] } {
  // Resolve item_schema. Groups can declare it inline OR reference a
  // sibling template (referenced_template_id). The referenced template
  // typically has a single top-level group whose item_schema is the
  // actual item shape — resolve through.
  const itemSchema = resolveGroupItemSchema(group, templatesById)
  const slotFields = itemSchema.filter(f => f.kind === 'slot')
  const nestedGroups = itemSchema.filter((f): f is WebGroupDef => f.kind === 'group')
  // Only descend into a nested group when THIS level has no slot
  // fields — i.e. this is a pure wrapper around the child group
  // (row_grid > card_team, or feature-section-2.card > card-193.card).
  // When the level already carries slot content (heading/description/
  // etc.) those slots ARE the items' fields; the nested groups are
  // accessories (e.g. a buttons group on a card). Stay here.
  if (nestedGroups.length > 0 && slotFields.length === 0) {
    const leaves: Record<string, unknown>[] = []
    for (const item of arr) {
      if (item == null || typeof item !== 'object') continue
      const obj = item as Record<string, unknown>
      for (const ng of nestedGroups) {
        const subArr = obj[ng.key]
        if (Array.isArray(subArr) && subArr.length > 0) {
          const recursed = drillToLeafItems(ng, subArr, templatesById)
          leaves.push(...recursed.items)
        }
      }
    }
    if (leaves.length > 0) {
      // Schema = the LEAF group's item_schema (one level deeper).
      const leafSchema = resolveGroupItemSchema(nestedGroups[0], templatesById)
        .filter(f => f.kind === 'slot')
        .map(f => f.key)
      return { items: leaves, schemaFromGroup: leafSchema }
    }
  }
  // No nested groups (or none with items) — use this level.
  const items = arr.filter((x): x is Record<string, unknown> => x != null && typeof x === 'object' && !Array.isArray(x))
  const schemaFromGroup = itemSchema
    .filter(f => f.kind === 'slot')
    .map(f => f.key)
  return { items, schemaFromGroup }
}

/** Resolve a group's item_schema. Returns the inline definition when
 *  present; else dereferences `referenced_template_id` and returns the
 *  referenced template's TOP-LEVEL fields verbatim (which usually
 *  declare another group whose items are the actual cards — let the
 *  drilling recursion handle the nesting). Returns an empty array if
 *  no schema can be resolved. */
function resolveGroupItemSchema(
  group: WebGroupDef,
  templatesById: Map<string, WebContentTemplate>,
): WebFieldDef[] {
  if (Array.isArray(group.item_schema) && group.item_schema.length > 0) {
    return group.item_schema
  }
  const refId = (group as { referenced_template_id?: string }).referenced_template_id
  if (!refId) return []
  const refTemplate = templatesById.get(refId)
  if (!refTemplate?.fields) return []
  // Return the referenced template's top-level fields. card-193 has
  // fields=[{kind:'group', key:'card', item_schema:[real schema]}],
  // so the outer card group's items each have a nested 'card' array
  // that the drilling recursion will descend into.
  return refTemplate.fields
}

function itemSummary(item: Record<string, unknown>): string | null {
  for (const key of ['team_name', 'name', 'title', 'heading', 'item_heading', 'primary_heading']) {
    const v = item[key]
    if (typeof v === 'string' && v.trim()) {
      return v.trim().replace(/<[^>]+>/g, '').slice(0, 80)
    }
  }
  return null
}

function inferTargetHint(
  role: SectionRole | null,
  inputs: FormationInputs,
  classifications: ClassificationRecord[],
): DiscoverySection['target_hint'] {
  if (!role) return 'unknown'
  // Detail roles always point at individual pages.
  if (role.endsWith('_detail')) return 'individual-page'
  // Listing roles (team_grid, blog_listing, etc.) — defer to the
  // analyzer's CPT recommendation. If single_template enabled,
  // individual page; else flat list.
  if (CPT_SECTION_ROLES.has(role)) {
    const slug = CPT_SLUG_BY_ROLE[role]
    if (slug) {
      const cpt = inputs  // reach into classifications to find suggestion
      const ref = `wp_object.${slug}`
      const cls = classifications.find(c => c.cpt_subroutine_ref === ref)
      // Without re-looking-up the WpObject, default by section_role's
      // single_template default. Conservative default per the
      // strategist's heuristic: listings (team_grid) → flat-list,
      // since detail roles are separate (staff_member_detail).
      void cpt; void cls
      const isListing = role === 'team_grid' || role === 'team_carousel' ||
                        role === 'blog_listing' || role === 'blog_featured' ||
                        role === 'career_listing'
      return isListing ? 'flat-list' : 'individual-page'
    }
  }
  // Display-preference-driven roles (event_detail, etc.) — derive.
  if (role === 'event_detail') {
    const pref = inputs.displayPreferences.events
    if (pref === 'external' || pref === 'embed') return 'embed'
    return 'individual-page'
  }
  return 'unknown'
}

// ═════════════════════════════════════════════════════════════════════
// PART D — Page-level Flexible Content detection (Rule 6)
// ═════════════════════════════════════════════════════════════════════

/** Looks at each approved page's section list. If a page has 5+
 *  sections with high content_template_id variety and no shared
 *  section_role pattern, mark its top-level structure as
 *  FLEXIBLE_CONTENT and surface the Bricks Nestable alternative.
 *
 *  Run AFTER classifyOne is done — this adjusts the page-level
 *  recommendation, not per-field classification. Returns one record
 *  per affected page, appended to the classifications list. */
export function detectFlexibleContentPages(
  inputs: FormationInputs,
): ClassificationRecord[] {
  const out: ClassificationRecord[] = []
  for (const page of inputs.approvedPages) {
    const sections = inputs.sectionsByPage.get(page.id) ?? []
    if (sections.length < 5) continue

    const contentSections = sections.filter(s => s.section_role && !CHROME_ROLES.has(s.section_role))
    const uniqueTemplates = new Set(contentSections.map(s => s.content_template_id).filter(Boolean))
    const uniqueRoles     = new Set(contentSections.map(s => s.section_role))

    // Heuristic: 5+ content sections, with high template diversity
    // (>= 4 distinct templates) and no role appearing more than twice.
    const maxRoleCount = Math.max(...[...uniqueRoles].map(r =>
      contentSections.filter(s => s.section_role === r).length
    ), 0)
    if (uniqueTemplates.size < 4 || maxRoleCount > 2) continue

    out.push({
      id:                  `${page.slug}/__page_layout`,
      page_slug:           page.slug,
      page_id:             page.id,
      section_id:          'PAGE_LEVEL',
      section_role:        null,
      item_label:          '__page_layout',
      structure:           'BRICKS_NESTABLE_SECTION',
      signals: {
        kind_in_template:        null,
        default_count:           null,
        actually_filled_count:   contentSections.length,
        section_role_reuse_count: 0,
        edit_frequency_proxy:    'medium',
        is_featured_global:      false,
        needs_own_url:           false,
        external_system:         null,
        cta_target_kind:         'unset',
        has_client_overrides:    false,
      },
      rationale: `Page has ${contentSections.length} sections across ${uniqueTemplates.size} distinct templates with no role appearing >2 times — modular layout. Default to Bricks Nestable sections for perf; ACF Flexible Content surfaced as alternative.`,
      recommended_default: 'BRICKS_NESTABLE_SECTION',
      alternative:         'FLEXIBLE_CONTENT',
      open_questions:      [
        `This page has many sections with high variety — should the dev build the layout with Bricks native nestable sections (recommended for perf), or with ACF Flexible Content for editor flexibility?`,
      ],
      confidence:          'medium',
      cpt_subroutine_ref:  null,
      status:              'suggested',
      override_reason:     null,
    })
  }
  return out
}
