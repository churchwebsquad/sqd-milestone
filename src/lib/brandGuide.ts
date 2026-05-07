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
  clear_space_note: string | null
}

export interface ColorDraft {
  id?: string
  name: string | null
  tier: import('../types/database').BrandColorTier
  hex: string
  cmyk: string | null
  rgb: string | null
  pms: string | null
  proportion_pct: number | null
  on_color_logo_url: string | null
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
  const [logos, colors, combos, fonts, elements, voiceAttrs, voiceGuidelines, brandAttrs] = await Promise.all([
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
  ])

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
  const slug = await generateUniqueSlug(params.displayName)

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
    })
    .select()
    .single()

  if (error || !data) throw error ?? new Error('Failed to create brand guide')
  return data as StrategyBrandGuide
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

/** Find a free slug by appending -2, -3, etc. when the base is taken. */
export async function generateUniqueSlug(displayName: string): Promise<string> {
  const base = slugify(displayName)
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
          clear_space_note: r.clear_space_note,
          sort_order: i,
        }).eq('id', r.id)
      if (error) throw new Error(error.message)
    } else {
      const { error } = await supabase.from('strategy_brand_logos').insert({
        brand_guide_id: guideId,
        kind: r.kind, label: r.label, preview_url: r.preview_url,
        download_url: r.download_url, animation_url: r.animation_url,
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
          name: r.name, tier: r.tier, hex: r.hex, cmyk: r.cmyk, rgb: r.rgb,
          pms: r.pms, proportion_pct: r.proportion_pct,
          on_color_logo_url: r.on_color_logo_url, sort_order: i,
        }).eq('id', r.id)
      if (error) throw new Error(error.message)
    } else {
      const { error } = await supabase.from('strategy_brand_colors').insert({
        brand_guide_id: guideId,
        name: r.name, tier: r.tier, hex: r.hex, cmyk: r.cmyk, rgb: r.rgb,
        pms: r.pms, proportion_pct: r.proportion_pct,
        on_color_logo_url: r.on_color_logo_url, sort_order: i,
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
          download_url: r.download_url, sort_order: i,
        }).eq('id', r.id)
      if (error) throw new Error(error.message)
    } else {
      const { error } = await supabase.from('strategy_brand_elements').insert({
        brand_guide_id: guideId,
        kind: r.kind, label: r.label, preview_url: r.preview_url,
        download_url: r.download_url, sort_order: i,
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
