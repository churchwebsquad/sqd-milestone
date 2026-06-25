import { supabase } from './supabase'
import type {
  StrategyBrandGuide,
  StrategyBrandLogo,
  StrategyBrandColor,
  StrategyBrandColorCombination,
  StrategyBrandTypography,
  StrategyBrandElement,
  StrategyBrandVoiceAttribute,
  StrategyBrandVoiceGuideline,
  StrategyBrandAttribute,
  StrategyBrandCustomSection,
  StrategyBrandCustomSectionEntry,
} from '../types/database'

/**
 * Full editable view of a single brand guide (root row + all children).
 * Loaded in one Promise.all per guide; saved via targeted upserts per section.
 */
export interface BrandGuideBundle {
  guide: StrategyBrandGuide
  logos: StrategyBrandLogo[]
  colors: StrategyBrandColor[]
  colorCombinations: StrategyBrandColorCombination[]
  typography: StrategyBrandTypography[]
  elements: StrategyBrandElement[]
  voiceAttributes: StrategyBrandVoiceAttribute[]
  voiceGuidelines: StrategyBrandVoiceGuideline[]
  attributes: StrategyBrandAttribute[]
  /** Open-ended user-defined sections (heading + entries). Each section
   *  carries its entries inline; CRUD operates per-section. */
  customSections: Array<StrategyBrandCustomSection & { entries: StrategyBrandCustomSectionEntry[] }>
}

/** Draft row types used by the editor — `id` is optional for not-yet-saved rows.
 *  Declared explicitly rather than via `Omit<T, …>` so the table types'
 *  `[key: string]: unknown` index signature (load-bearing for Supabase's
 *  typed insert overloads) doesn't leak through and blur field types. */

export interface LogoDraft {
  id?: string
  kind: import('../types/database').BrandLogoKind
  label: string | null
  preview_url: string
  download_url: string | null
  /** Optional motion version of this logo (mp4/webm/Lottie). Surfaced
   *  alongside the still preview on the public portal + handoff. */
  animation_url: string | null
  /** Optional hex (e.g. #1e2a44) to render behind this logo on the
   *  portal — for light/inverse logos that disappear against white. */
  background_color: string | null
  clear_space_note: string | null
}

export interface ColorDraft {
  id?: string
  name: string | null
  tier: import('../types/database').BrandColorTier
  /** Staff-only flag: which palette swatch acts as page bg / body text
   *  on the portal theme. Null for normal palette colors. */
  interface_role: import('../types/database').BrandColorInterfaceRole | null
  hex: string
  cmyk: string | null
  rgb: string | null
  pms: string | null
  proportion_pct: number | null
  on_color_logo_url: string | null
  /** Scale percent (10-200) applied to the on-color logo on the
   *  portal. Default 100 = native size. */
  on_color_logo_scale_pct: number | null
}

export interface CombinationDraft {
  id?: string
  bg_color_id: string | null
  fg_color_id: string | null
  override_logo_url: string | null
}

export interface TypographyDraft {
  id?: string
  tier: import('../types/database').BrandTypographyTier
  family_name: string
  weight: string | null
  /** Friendly weight description ("Bold", "Semibold"). */
  weight_label: string | null
  suggested_use: string | null
  /** How the typeface should be set ("UPPERCASE", "Title Case", …). */
  letter_case: string | null
  /** Open-source source — Google Fonts URL or uploaded webfont. */
  font_url: string | null
  /** If the family is a paid/custom font, purchase URL for the license. */
  custom_font_purchase_url: string | null
  /** Royalty-free alternative when the paid font isn't licensed. */
  free_alt_family: string | null
  free_alt_font_url: string | null
  /** CSS family used on the online brand guide + web deliverables. */
  web_font_family: string | null
}

export interface ElementDraft {
  id?: string
  kind: import('../types/database').BrandElementKind
  label: string | null
  preview_url: string | null
  download_url: string | null
  /** Optional hex bg for the element preview tile — helps low-opacity
   *  patterns / textures stay visible on the portal. */
  pattern_background_color: string | null
}

export interface VoiceAttributeDraft {
  id?: string
  title: string
  description: string
}

export interface VoiceGuidelineDraft {
  id?: string
  title: string
  description: string
}

export interface AttributeDraft {
  id?: string
  label: string
  description: string | null
}

// ── Load / create / meta update ─────────────────────────────────────────────

/**
 * Load the main brand guide for a given church (member), plus all of its
 * child rows. Returns null if the church has no brand guide row yet.
 * Subbrands are listed separately via `loadSubbrandsFor`.
 */
export async function loadMainGuideByMember(memberId: number): Promise<BrandGuideBundle | null> {
  const { data: guide, error } = await supabase
    .from('strategy_brand_guides')
    .select('*')
    .eq('member', memberId)
    .is('parent_id', null)
    .maybeSingle()

  if (error) throw error
  if (!guide) return null

  return loadChildren(guide as StrategyBrandGuide)
}

/**
 * List all subbrand (child) guides for a given parent guide. Returns the raw
 * rows so the editor can show display_name + slug in the Ministries list.
 */
export async function loadSubbrandsFor(parentId: string): Promise<StrategyBrandGuide[]> {
  const { data, error } = await supabase
    .from('strategy_brand_guides')
    .select('*')
    .eq('parent_id', parentId)
    .order('created_at', { ascending: true })

  if (error) throw error
  return (data ?? []) as StrategyBrandGuide[]
}

/**
 * Load any brand guide (main or subbrand) by slug, plus its children. Used
 * by the editor when a `:subSlug` is present in the route.
 */
export async function loadGuideBySlug(slug: string): Promise<BrandGuideBundle | null> {
  const { data: guide, error } = await supabase
    .from('strategy_brand_guides')
    .select('*')
    .eq('slug', slug)
    .maybeSingle()

  if (error) throw error
  if (!guide) return null

  return loadChildren(guide as StrategyBrandGuide)
}

async function loadChildren(guide: StrategyBrandGuide): Promise<BrandGuideBundle> {
  const [logos, colors, combos, fonts, elements, voiceAttrs, voiceGuidelines, brandAttrs, customSections] = await Promise.all([
    supabase.from('strategy_brand_logos')
      .select('*').eq('brand_guide_id', guide.id).order('sort_order'),
    supabase.from('strategy_brand_colors')
      .select('*').eq('brand_guide_id', guide.id).order('sort_order'),
    supabase.from('strategy_brand_color_combinations')
      .select('*').eq('brand_guide_id', guide.id).order('sort_order'),
    supabase.from('strategy_brand_typography')
      .select('*').eq('brand_guide_id', guide.id).order('sort_order'),
    supabase.from('strategy_brand_elements')
      .select('*').eq('brand_guide_id', guide.id).order('sort_order'),
    supabase.from('strategy_brand_voice_attributes')
      .select('*').eq('brand_guide_id', guide.id).order('sort_order'),
    supabase.from('strategy_brand_voice_guidelines')
      .select('*').eq('brand_guide_id', guide.id).order('sort_order'),
    supabase.from('strategy_brand_attributes')
      .select('*').eq('brand_guide_id', guide.id).order('sort_order'),
    // Fetch sections + their entries in one round-trip via embedded select.
    supabase.from('strategy_brand_custom_sections')
      .select('*, entries:strategy_brand_custom_section_entries(*)')
      .eq('brand_guide_id', guide.id).order('sort_order'),
  ])

  // Normalize embedded entries — Supabase returns them inline already
  // sorted-ish; explicit sort keeps the editor's order deterministic.
  const csRows = (customSections.data ?? []) as Array<StrategyBrandCustomSection & {
    entries: StrategyBrandCustomSectionEntry[] | null
  }>
  const customSectionsNormalized = csRows.map(s => ({
    ...s,
    entries: (s.entries ?? []).slice().sort(
      (a, b) => (a.sort_order - b.sort_order) || a.created_at.localeCompare(b.created_at),
    ),
  }))

  return {
    guide,
    logos:             (logos.data           ?? []) as StrategyBrandLogo[],
    colors:            (colors.data          ?? []) as StrategyBrandColor[],
    colorCombinations: (combos.data          ?? []) as StrategyBrandColorCombination[],
    typography:        (fonts.data           ?? []) as StrategyBrandTypography[],
    elements:          (elements.data        ?? []) as StrategyBrandElement[],
    voiceAttributes:   (voiceAttrs.data      ?? []) as StrategyBrandVoiceAttribute[],
    voiceGuidelines:   (voiceGuidelines.data ?? []) as StrategyBrandVoiceGuideline[],
    attributes:        (brandAttrs.data      ?? []) as StrategyBrandAttribute[],
    customSections:    customSectionsNormalized,
  }
}

/**
 * Create a new main brand guide for a church. The slug is generated from the
 * display name and de-duplicated against existing rows.
 */
export async function createMainGuide(params: {
  memberId: number
  displayName: string
  createdBy: string | null
}): Promise<StrategyBrandGuide> {
  // Look up the partner's address from accounts so we can prefix the
  // slug with state (and disambiguate by city on collision). When
  // accounts has no row OR the address is unparseable / international,
  // both parts come back null and the slug falls back to flat behavior.
  const { state, city } = await resolveSlugStateAndCity(params.memberId)
  const slug = await generateUniqueSlug(params.displayName, { state, city })

  const { data, error } = await supabase
    .from('strategy_brand_guides')
    .insert({
      member: params.memberId,
      parent_id: null,
      slug,
      display_name: params.displayName,
      contact_name: null,
      contact_email: null,
      voice_overview: null,
      brand_statement: null,
      assets_zip_url: null,
      is_published: false,
      last_updated_at: null,
      created_by: params.createdBy,
      slug_state: state,
      slug_city:  city,
    } as Record<string, unknown>)
    .select()
    .single()

  if (error || !data) throw error ?? new Error('Failed to create brand guide')
  return data as StrategyBrandGuide
}

/** Look up the partner's address from the accounts table and parse a
 *  state/city pair out of it. Returns nulls when the row is missing
 *  or the address doesn't match a US postal pattern (international
 *  partners fall through to the flat-slug path). */
async function resolveSlugStateAndCity(memberId: number): Promise<{ state: string | null; city: string | null }> {
  const { data } = await supabase
    .from('accounts')
    .select('address')
    .eq('account', memberId)
    .maybeSingle()
  const address = (data as { address?: string | null } | null)?.address ?? null
  return parseStateAndCityFromAddress(address)
}

/**
 * Create a new subbrand (ministry) under a parent guide. Same `member` as the
 * parent so access control works identically. The slug is scoped under the
 * parent's slug (`{parent-slug}/{ministry-slug}`) so public URLs read
 * `/brand/{church}/{ministry}`.
 */
export async function createSubbrand(params: {
  parentGuide: StrategyBrandGuide
  displayName: string
  createdBy: string | null
}): Promise<StrategyBrandGuide> {
  const slug = await generateUniqueSubSlug(params.parentGuide.slug, params.displayName)

  const { data, error } = await supabase
    .from('strategy_brand_guides')
    .insert({
      member: params.parentGuide.member,
      parent_id: params.parentGuide.id,
      slug,
      display_name: params.displayName,
      contact_name: null,
      contact_email: null,
      voice_overview: null,
      brand_statement: null,
      assets_zip_url: null,
      is_published: false,
      last_updated_at: null,
      created_by: params.createdBy,
    })
    .select()
    .single()

  if (error || !data) throw error ?? new Error('Failed to create subbrand')
  return data as StrategyBrandGuide
}

/** The short (ministry-only) slug portion of a subbrand's composite slug. */
export function subbrandShortSlug(subbrand: StrategyBrandGuide): string {
  const parts = subbrand.slug.split('/')
  return parts[parts.length - 1] || subbrand.slug
}

/** Patch fields on the root guide row. Also bumps last_updated_at. */
export async function updateGuideMeta(
  guideId: string,
  patch: Partial<Omit<StrategyBrandGuide, 'id' | 'created_at' | 'updated_at'>>,
): Promise<StrategyBrandGuide> {
  const { data, error } = await supabase
    .from('strategy_brand_guides')
    .update({ ...patch, last_updated_at: new Date().toISOString() } as Record<string, unknown>)
    .eq('id', guideId)
    .select()
    .single()

  if (error || !data) throw error ?? new Error('Failed to update brand guide')
  return data as StrategyBrandGuide
}

// ── Slug generation ─────────────────────────────────────────────────────────

/** Convert a display name into a URL-safe slug candidate. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'brand'
}

/** Parse a US state abbreviation + city from a free-form address string.
 *
 * Targets the canonical US postal shape: `... <City>, <ST> <ZIP> ...`
 * with tolerance for missing commas and double spaces (real data in the
 * accounts table includes "TX  78216" and "CA, 95129" variants).
 *
 * Returns nulls when the regex doesn't match (international addresses,
 * empty strings, PO-box-only formats) — callers fall back to the flat
 * slug behavior.
 */
export function parseStateAndCityFromAddress(
  address: string | null | undefined,
): { state: string | null; city: string | null } {
  if (!address || typeof address !== 'string') return { state: null, city: null }
  const trimmed = address.trim()
  if (!trimmed) return { state: null, city: null }

  // State + ZIP. `,?` covers "CA, 95129"; `\s+` covers "TX  78216".
  const m = trimmed.match(/\b([A-Z]{2}),?\s+\d{5}\b/)
  if (!m) return { state: null, city: null }
  const state = m[1].toLowerCase()

  // City is the token immediately before the state in the address —
  // usually preceded by a comma (e.g. "San Jose, CA 95129") or by
  // whitespace on the more-broken records. Scan backward from the
  // state match.
  const upto = trimmed.slice(0, m.index ?? 0).trimEnd().replace(/,$/, '').trimEnd()
  // Pull the LAST comma-separated chunk; if no commas, the last
  // whitespace-separated token.
  let cityRaw: string | null = null
  if (upto.includes(',')) {
    const parts = upto.split(',').map(s => s.trim()).filter(Boolean)
    cityRaw = parts[parts.length - 1] ?? null
  } else {
    const parts = upto.split(/\s+/).filter(Boolean)
    cityRaw = parts[parts.length - 1] ?? null
  }
  const city = cityRaw ? slugify(cityRaw) || null : null
  return { state, city }
}

/** Find a free slug by appending -2, -3, etc. when the base is taken.
 *
 * When `state` is provided, the canonical slug shape is `{state}/{base}`
 * (e.g. `tx/lakeway`). On collision the chain escalates:
 *   1. {state}/{base}
 *   2. {state}/{city}-{base}     (when city is also provided)
 *   3. {state}/{base}-2, -3, …   (numeric fallback)
 *
 * When `state` is not provided, behavior matches the original flat
 * shape: `{base}`, then `-2`, `-3`, … on collision.
 */
export async function generateUniqueSlug(
  displayName: string,
  opts: { state?: string | null; city?: string | null } = {},
): Promise<string> {
  const base = slugify(displayName)
  const state = (opts.state ?? null)?.trim().toLowerCase() || null
  const city  = (opts.city  ?? null)?.trim().toLowerCase() || null

  // Pre-load every slug that COULD collide. We over-fetch a bit (any
  // slug whose last segment starts with `base`) so the in-memory
  // collision check is exact without a network round-trip per
  // candidate.
  const { data: existing } = await supabase
    .from('strategy_brand_guides')
    .select('slug')
    .or(`slug.ilike.${base}%,slug.ilike.%/${base}%`)
  const taken = new Set((existing ?? []).map((r: { slug: string }) => r.slug))

  // No state → original flat behavior.
  if (!state) {
    if (!taken.has(base)) return base
    let n = 2
    while (taken.has(`${base}-${n}`)) n++
    return `${base}-${n}`
  }

  // State known: try state/base first.
  const stateBase = `${state}/${base}`
  if (!taken.has(stateBase)) return stateBase

  // Fall back to {state}/{city}-{base} when city is available and not
  // already taken. Skip this rung if city is missing or matches base
  // (e.g. a town literally called "Lakeway" → `tx/lakeway-lakeway`
  // is uglier than the numeric fallback below).
  if (city && city !== base) {
    const stateCityBase = `${state}/${city}-${base}`
    if (!taken.has(stateCityBase)) return stateCityBase
  }

  // Final fallback: numeric suffix on the {state}/{base} form.
  let n = 2
  while (taken.has(`${stateBase}-${n}`)) n++
  return `${stateBase}-${n}`
}

/**
 * Scoped subbrand slug under a parent — `{parent}/{ministry}`, de-duplicated
 * by appending -2, -3, etc. on the ministry portion only. This keeps the
 * church namespace intact so every ministry URL reads cleanly.
 */
export async function generateUniqueSubSlug(parentSlug: string, displayName: string): Promise<string> {
  const ministry = slugify(displayName)
  const base = `${parentSlug}/${ministry}`
  const { data: existing } = await supabase
    .from('strategy_brand_guides')
    .select('slug')
    .ilike('slug', `${base}%`)
  const taken = new Set((existing ?? []).map((r: { slug: string }) => r.slug))
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(`${base}-${n}`)) n++
  return `${base}-${n}`
}

// ── Per-section save helpers ────────────────────────────────────────────────
//
// Each section's save takes the latest array from the editor and syncs it to
// the DB: delete rows that are no longer present, update existing rows by id,
// insert new rows without ids. Sort order is normalized by array index.
//
// These are typed explicitly per table to keep Supabase's tight row types
// happy without generics fighting the type checker.

async function deleteMissing(table: string, existingIds: string[], keepIds: Set<string>): Promise<void> {
  const toDelete = existingIds.filter(id => !keepIds.has(id))
  if (toDelete.length === 0) return
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from(table as any) as any).delete().in('id', toDelete)
  if (error) throw new Error(error.message)
}

export async function saveLogos(
  guideId: string,
  rows: LogoDraft[],
  existingIds: string[],
): Promise<void> {
  const keep = new Set(rows.filter(r => r.id).map(r => r.id!))
  await deleteMissing('strategy_brand_logos', existingIds, keep)
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    if (r.id) {
      const { error } = await supabase.from('strategy_brand_logos')
        .update({
          kind: r.kind, label: r.label, preview_url: r.preview_url,
          download_url: r.download_url, animation_url: r.animation_url,
          background_color: r.background_color,
          clear_space_note: r.clear_space_note,
          sort_order: i,
        }).eq('id', r.id)
      if (error) throw new Error(error.message)
    } else {
      const { error } = await supabase.from('strategy_brand_logos').insert({
        brand_guide_id: guideId,
        kind: r.kind, label: r.label, preview_url: r.preview_url,
        download_url: r.download_url, animation_url: r.animation_url,
        background_color: r.background_color,
        clear_space_note: r.clear_space_note,
        sort_order: i,
      })
      if (error) throw new Error(error.message)
    }
  }
}

export async function saveColors(
  guideId: string,
  rows: ColorDraft[],
  existingIds: string[],
): Promise<void> {
  const keep = new Set(rows.filter(r => r.id).map(r => r.id!))
  await deleteMissing('strategy_brand_colors', existingIds, keep)
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    if (r.id) {
      const { error } = await supabase.from('strategy_brand_colors')
        .update({
          name: r.name, tier: r.tier, interface_role: r.interface_role,
          hex: r.hex, cmyk: r.cmyk, rgb: r.rgb,
          pms: r.pms, proportion_pct: r.proportion_pct,
          on_color_logo_url: r.on_color_logo_url,
          on_color_logo_scale_pct: r.on_color_logo_scale_pct,
          sort_order: i,
        }).eq('id', r.id)
      if (error) throw new Error(error.message)
    } else {
      const { error } = await supabase.from('strategy_brand_colors').insert({
        brand_guide_id: guideId,
        name: r.name, tier: r.tier, interface_role: r.interface_role,
        hex: r.hex, cmyk: r.cmyk, rgb: r.rgb,
        pms: r.pms, proportion_pct: r.proportion_pct,
        on_color_logo_url: r.on_color_logo_url,
        on_color_logo_scale_pct: r.on_color_logo_scale_pct,
        sort_order: i,
      })
      if (error) throw new Error(error.message)
    }
  }
}

export async function saveColorCombinations(
  guideId: string,
  rows: CombinationDraft[],
  existingIds: string[],
): Promise<void> {
  const keep = new Set(rows.filter(r => r.id).map(r => r.id!))
  await deleteMissing('strategy_brand_color_combinations', existingIds, keep)
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    if (r.id) {
      const { error } = await supabase.from('strategy_brand_color_combinations')
        .update({
          bg_color_id: r.bg_color_id, fg_color_id: r.fg_color_id,
          override_logo_url: r.override_logo_url, sort_order: i,
        }).eq('id', r.id)
      if (error) throw new Error(error.message)
    } else {
      const { error } = await supabase.from('strategy_brand_color_combinations').insert({
        brand_guide_id: guideId,
        bg_color_id: r.bg_color_id, fg_color_id: r.fg_color_id,
        override_logo_url: r.override_logo_url, sort_order: i,
      })
      if (error) throw new Error(error.message)
    }
  }
}

export async function saveTypography(
  guideId: string,
  rows: TypographyDraft[],
  existingIds: string[],
): Promise<void> {
  const keep = new Set(rows.filter(r => r.id).map(r => r.id!))
  await deleteMissing('strategy_brand_typography', existingIds, keep)
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    const fields = {
      tier: r.tier,
      family_name: r.family_name,
      weight: r.weight,
      weight_label: r.weight_label,
      suggested_use: r.suggested_use,
      letter_case: r.letter_case,
      font_url: r.font_url,
      custom_font_purchase_url: r.custom_font_purchase_url,
      free_alt_family: r.free_alt_family,
      free_alt_font_url: r.free_alt_font_url,
      web_font_family: r.web_font_family,
      sort_order: i,
    }
    if (r.id) {
      const { error } = await supabase.from('strategy_brand_typography')
        .update(fields).eq('id', r.id)
      if (error) throw new Error(error.message)
    } else {
      const { error } = await supabase.from('strategy_brand_typography').insert({
        brand_guide_id: guideId,
        ...fields,
      })
      if (error) throw new Error(error.message)
    }
  }
}

export async function saveElements(
  guideId: string,
  rows: ElementDraft[],
  existingIds: string[],
): Promise<void> {
  const keep = new Set(rows.filter(r => r.id).map(r => r.id!))
  await deleteMissing('strategy_brand_elements', existingIds, keep)
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    if (r.id) {
      const { error } = await supabase.from('strategy_brand_elements')
        .update({
          kind: r.kind, label: r.label, preview_url: r.preview_url,
          download_url: r.download_url,
          pattern_background_color: r.pattern_background_color,
          sort_order: i,
        }).eq('id', r.id)
      if (error) throw new Error(error.message)
    } else {
      const { error } = await supabase.from('strategy_brand_elements').insert({
        brand_guide_id: guideId,
        kind: r.kind, label: r.label, preview_url: r.preview_url,
        download_url: r.download_url,
        pattern_background_color: r.pattern_background_color,
        sort_order: i,
      })
      if (error) throw new Error(error.message)
    }
  }
}

export async function saveVoiceAttributes(
  guideId: string,
  rows: VoiceAttributeDraft[],
  existingIds: string[],
): Promise<void> {
  const keep = new Set(rows.filter(r => r.id).map(r => r.id!))
  await deleteMissing('strategy_brand_voice_attributes', existingIds, keep)
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    if (r.id) {
      const { error } = await supabase.from('strategy_brand_voice_attributes')
        .update({ title: r.title, description: r.description, sort_order: i }).eq('id', r.id)
      if (error) throw new Error(error.message)
    } else {
      const { error } = await supabase.from('strategy_brand_voice_attributes').insert({
        brand_guide_id: guideId,
        title: r.title, description: r.description, sort_order: i,
      })
      if (error) throw new Error(error.message)
    }
  }
}

export async function saveVoiceGuidelines(
  guideId: string,
  rows: VoiceGuidelineDraft[],
  existingIds: string[],
): Promise<void> {
  const keep = new Set(rows.filter(r => r.id).map(r => r.id!))
  await deleteMissing('strategy_brand_voice_guidelines', existingIds, keep)
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    if (r.id) {
      const { error } = await supabase.from('strategy_brand_voice_guidelines')
        .update({ title: r.title, description: r.description, sort_order: i }).eq('id', r.id)
      if (error) throw new Error(error.message)
    } else {
      const { error } = await supabase.from('strategy_brand_voice_guidelines').insert({
        brand_guide_id: guideId,
        title: r.title, description: r.description, sort_order: i,
      })
      if (error) throw new Error(error.message)
    }
  }
}

export async function saveBrandAttributes(
  guideId: string,
  rows: AttributeDraft[],
  existingIds: string[],
): Promise<void> {
  const keep = new Set(rows.filter(r => r.id).map(r => r.id!))
  await deleteMissing('strategy_brand_attributes', existingIds, keep)
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    if (r.id) {
      const { error } = await supabase.from('strategy_brand_attributes')
        .update({ label: r.label, description: r.description, sort_order: i }).eq('id', r.id)
      if (error) throw new Error(error.message)
    } else {
      const { error } = await supabase.from('strategy_brand_attributes').insert({
        brand_guide_id: guideId,
        label: r.label, description: r.description, sort_order: i,
      })
      if (error) throw new Error(error.message)
    }
  }
}

// ── Custom sections ─────────────────────────────────────────────────────────
//
// Section meta and entries save independently. The editor passes draft
// shapes (id may be missing for new rows); the helper diffs against
// existing ids, deletes removed rows, then upserts the rest with their
// new sort_order. Mirrors `saveVoiceGuidelines` so the editor's mental
// model stays consistent across all heading+body sections.

export interface CustomSectionEntryDraft {
  id?: string
  title: string
  body: string
}

export interface CustomSectionDraft {
  id?: string
  heading: string
  description: string | null
  column_count: number
  entries: CustomSectionEntryDraft[]
}

/** Create a new section row. The caller usually follows up with
 *  `saveCustomSectionEntries` to attach entries. */
export async function createCustomSection(
  guideId: string,
  heading: string,
  description: string | null,
  column_count: number,
  sort_order: number,
): Promise<StrategyBrandCustomSection> {
  const { data, error } = await supabase
    .from('strategy_brand_custom_sections')
    .insert({ brand_guide_id: guideId, heading, description, column_count, sort_order })
    .select()
    .single()
  if (error || !data) throw error ?? new Error('Failed to create custom section')
  return data as StrategyBrandCustomSection
}

/** Patch a section's heading / description / column_count / sort_order. */
export async function updateCustomSection(
  sectionId: string,
  patch: Partial<Pick<StrategyBrandCustomSection,
    'heading' | 'description' | 'column_count' | 'sort_order'>>,
): Promise<StrategyBrandCustomSection> {
  const { data, error } = await supabase
    .from('strategy_brand_custom_sections')
    .update(patch as Record<string, unknown>)
    .eq('id', sectionId)
    .select()
    .single()
  if (error || !data) throw error ?? new Error('Failed to update custom section')
  return data as StrategyBrandCustomSection
}

/** Delete a section. CASCADE on the FK removes its entries automatically. */
export async function deleteCustomSection(sectionId: string): Promise<void> {
  const { error } = await supabase
    .from('strategy_brand_custom_sections')
    .delete()
    .eq('id', sectionId)
  if (error) throw new Error(error.message)
}

/** Diff + upsert entries for one custom section. Pass current entries
 *  + existing ids so removed-from-draft entries get deleted. */
export async function saveCustomSectionEntries(
  sectionId:   string,
  rows:        CustomSectionEntryDraft[],
  existingIds: string[],
): Promise<void> {
  const keep = new Set(rows.filter(r => r.id).map(r => r.id!))
  await deleteMissingEntries(existingIds, keep)
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    if (r.id) {
      const { error } = await supabase.from('strategy_brand_custom_section_entries')
        .update({ title: r.title, body: r.body, sort_order: i })
        .eq('id', r.id)
      if (error) throw new Error(error.message)
    } else {
      const { error } = await supabase.from('strategy_brand_custom_section_entries').insert({
        custom_section_id: sectionId,
        title: r.title, body: r.body, sort_order: i,
      })
      if (error) throw new Error(error.message)
    }
  }
}

async function deleteMissingEntries(existingIds: string[], keep: Set<string>): Promise<void> {
  const toDrop = existingIds.filter(id => !keep.has(id))
  if (toDrop.length === 0) return
  const { error } = await supabase
    .from('strategy_brand_custom_section_entries')
    .delete()
    .in('id', toDrop)
  if (error) throw new Error(error.message)
}
