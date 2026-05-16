/**
 * Brixies family semantics — what each family is actually used for.
 *
 * The catalog stores 23 families with structural slot/group shapes but
 * no semantic context. Without that, the AI auto-bind treats "Banner
 * Section" and "Feature Section" as interchangeable content holders,
 * which is wrong — Banner Sections are scrolling marquees / accent
 * strips, not authored content bodies.
 *
 * This module is the single source of truth for "what is family X for"
 * and which families are appropriate as broad content fallbacks when
 * cowork's brief-suggested family is a poor structural match.
 */

/** Per-family role + when-to-use guidance. Surfaced in the AI prompt
 *  + used to widen candidate pools when the brief's hint is weak. */
export interface FamilyMeta {
  /** One-sentence role description for the AI prompt. */
  usage: string
  /** True when this family is appropriate as a generic content body
   *  for any section. We always include candidates from these families
   *  in the AI's pool, even when the brief suggested something else. */
  is_content_fallback?: boolean
  /** True when this family is a narrow-use accent — should NOT be
   *  picked for ordinary content sections. The AI sees this flag and
   *  is instructed to use it only when the content matches the role. */
  is_narrow_use?: boolean
}

export const FAMILY_META: Record<string, FamilyMeta> = {
  'Hero Section': {
    usage: 'Above-the-fold landing block. One per page, top of layout. Tagline + headline + body + CTAs + optional image/video.',
  },
  'Feature Section': {
    usage: 'Card grid or card carousel for showcasing 2+ parallel items (ministries, events, features). Good for "we have X, Y, Z" content.',
    is_content_fallback: true,
  },
  'Content Section': {
    usage: 'General authored content — heading + body + optional image. The default for paragraph-bearing prose with no card structure.',
    is_content_fallback: true,
  },
  'Banner Section': {
    usage: 'NARROW USE: scrolling marquee or announcement strip with very short text (e.g. "Service times changed for holiday"). NOT a body content holder — do NOT pick for paragraph content even if the brief suggests it.',
    is_narrow_use: true,
  },
  'CTA Section': {
    usage: 'Focused call-to-action block — heading + short body + button(s). Use for conversion points (Plan a Visit, Give Now, Sign Up).',
    is_content_fallback: true,
  },
  'Process Section': {
    usage: 'Numbered steps in a flow (1, 2, 3...). Use when sequence matters — "What to expect on your first Sunday," giving steps, onboarding.',
  },
  'Timeline Section': {
    usage: 'Chronological story / history. Use for church history, milestone timelines.',
  },
  'FAQ Section': {
    usage: 'Question + answer pairs, typically accordion-shaped.',
  },
  'Team Section': {
    usage: 'Staff/team grid with photos + names + titles + bios. Specifically for people-listings.',
  },
  'Intro Section': {
    usage: 'Page-opener content directly below the hero. Short, framing copy.',
    is_content_fallback: true,
  },
  'Gallery Section': {
    usage: 'Image-heavy showcase grid. Use when the content is visual (photo gallery, video stories).',
  },
  'Blog Section': {
    usage: 'Card listing for blog posts / articles. Use for archive-style listings.',
  },
  'Career Section': {
    usage: 'Job listings.',
  },
  'Card': {
    usage: 'Reusable card component for grids. NOT a page section — only used inside Feature/Team/Blog sections.',
    is_narrow_use: true,
  },
  'Footer': {
    usage: 'Site-wide page footer chrome. NOT for in-page content.',
    is_narrow_use: true,
  },
  'Header': {
    usage: 'Site-wide navigation chrome. NOT for in-page content.',
    is_narrow_use: true,
  },
  'Megamenu Section': {
    usage: 'Expanded dropdown navigation chrome. NOT for in-page content.',
    is_narrow_use: true,
  },
  'Offcanvas': {
    usage: 'Mobile / slide-in navigation chrome. NOT for in-page content.',
    is_narrow_use: true,
  },
  'Category Filter': {
    usage: 'Filter UI for archive pages. Functional, not editorial.',
    is_narrow_use: true,
  },
  'Single Event Section': {
    usage: 'Detail page template for an individual event. Title + date + location + description + register CTA.',
  },
  'Single Post Section': {
    usage: 'Detail page template for a blog post / article.',
  },
  'Single Team Section': {
    usage: 'Detail page template for an individual staff member.',
  },
  'Link Page': {
    usage: 'Linktree-style page of stacked links.',
    is_narrow_use: true,
  },
}

/** Look up usage text for a family. Falls back to a generic descriptor
 *  when the family isn't in the table — so new Brixies families that
 *  haven't been classified here still get a sensible default. */
export function familyUsage(family: string): string {
  const meta = FAMILY_META[family]
  return meta?.usage ?? `${family} — general purpose section.`
}

/** Whether a family is appropriate as a generic content fallback. */
export function isContentFallbackFamily(family: string): boolean {
  return !!FAMILY_META[family]?.is_content_fallback
}

/** Whether a family is narrow-use (accent / chrome / functional). */
export function isNarrowUseFamily(family: string): boolean {
  return !!FAMILY_META[family]?.is_narrow_use
}

/** The list of content-fallback family names — always included in the
 *  AI's candidate pool so the model can override a misclassified brief
 *  hint. */
export const CONTENT_FALLBACK_FAMILIES: readonly string[] = Object.entries(FAMILY_META)
  .filter(([, m]) => m.is_content_fallback)
  .map(([name]) => name)
