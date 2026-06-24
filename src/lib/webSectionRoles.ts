/**
 * Section role taxonomy.
 *
 * A section's role is its STABLE slot identity — "what this section
 * IS at the page level" — decoupled from the Brixies layout we used
 * to wireframe it. Roles survive Figma swaps so handoff metadata
 * follows the slot, not the underlying layout.
 *
 * Composed display name:
 *   {page_name} · Section {sort_order} · {role_label}
 *   e.g.  "Events page · Section 3 · Simple CTA banner"
 *
 * The role enum lives on src/types/database.ts (SectionRole). This
 * file owns the labels + groupings + the section-name composer.
 */

import type { SectionRole, WebSection, WebPage } from '../types/database'

/** Default human-readable label for each role. A section can override
 *  this via web_sections.section_role_label when the project needs a
 *  slightly different phrasing. */
export const SECTION_ROLE_LABELS: Record<SectionRole, string> = {
  // Hero / banner
  hero_home:            'Home hero',
  hero_innerpage:       'Innerpage hero',
  hero_visual:          'Visual hero',
  banner_announcement:  'Announcement banner',

  // Intro / content
  intro_text:           'Intro text',
  content_block:        'Content block',
  mission_statement:    'Mission statement',
  verse_callout:        'Verse callout',

  // Features / cards
  feature_grid:         'Feature grid',
  feature_split:        'Feature split',
  card_grid:            'Card grid',
  card_carousel:        'Card carousel',

  // CTA
  cta_banner_simple:    'Simple CTA banner',
  cta_banner_split:     'Split CTA banner',
  cta_full_bleed:       'Full-bleed CTA',

  // People
  team_grid:            'Team grid',
  team_carousel:        'Team carousel',
  staff_member_detail:  'Staff member detail',

  // Process / timeline
  steps_horizontal:     'Steps (horizontal)',
  steps_vertical:       'Steps (vertical)',
  timeline_chronology:  'Timeline',

  // FAQ
  faq_accordion:        'FAQ accordion',
  faq_grid:             'FAQ grid',

  // Filter / search
  category_filter:      'Category filter',
  search_bar:           'Search bar',

  // Single content
  event_detail:         'Event detail',
  post_detail:          'Post detail',

  // Gallery
  gallery_grid:         'Gallery grid',
  gallery_carousel:     'Gallery carousel',

  // Career
  career_listing:       'Career listing',
  career_detail:        'Career detail',

  // Blog
  blog_listing:         'Blog listing',
  blog_featured:        'Featured blog',

  // Chrome
  nav_header:           'Header',
  footer_main:          'Footer',
  offcanvas_menu:       'Offcanvas menu',
  megamenu:             'Megamenu',
  link_page:            'Link page',

  // Catch-all
  custom:               'Custom section',
}

/** Roles grouped for the picker UI. Order is the picker's render order. */
export const SECTION_ROLE_GROUPS: ReadonlyArray<{ label: string; roles: SectionRole[] }> = [
  { label: 'Hero / Banner',     roles: ['hero_home', 'hero_innerpage', 'hero_visual', 'banner_announcement'] },
  { label: 'Intro / Content',   roles: ['intro_text', 'content_block', 'mission_statement', 'verse_callout'] },
  { label: 'Features / Cards',  roles: ['feature_grid', 'feature_split', 'card_grid', 'card_carousel'] },
  { label: 'CTA',               roles: ['cta_banner_simple', 'cta_banner_split', 'cta_full_bleed'] },
  { label: 'People',            roles: ['team_grid', 'team_carousel', 'staff_member_detail'] },
  { label: 'Process / Timeline', roles: ['steps_horizontal', 'steps_vertical', 'timeline_chronology'] },
  { label: 'FAQ',               roles: ['faq_accordion', 'faq_grid'] },
  { label: 'Filter / Search',   roles: ['category_filter', 'search_bar'] },
  { label: 'Single content',    roles: ['event_detail', 'post_detail'] },
  { label: 'Gallery',           roles: ['gallery_grid', 'gallery_carousel'] },
  { label: 'Career',            roles: ['career_listing', 'career_detail'] },
  { label: 'Blog',              roles: ['blog_listing', 'blog_featured'] },
  { label: 'Chrome',            roles: ['nav_header', 'footer_main', 'offcanvas_menu', 'megamenu', 'link_page'] },
  { label: 'Other',             roles: ['custom'] },
]

/** Map a Brixies template family + name to a best-guess section role.
 *  Used as the default when the strategist hasn't explicitly classified
 *  a section yet. Lossy by design — the strategist can always override
 *  via the section role picker. */
export function inferSectionRoleFromTemplate(
  family: string | null | undefined,
  layerName: string | null | undefined,
): SectionRole | null {
  const f = (family ?? '').toLowerCase()
  const n = (layerName ?? '').toLowerCase()
  // Hero / banner
  if (f === 'hero section') return /innerpage|inner/.test(n) ? 'hero_innerpage' : 'hero_home'
  if (f === 'banner section') return 'banner_announcement'
  // Intro / content
  if (f === 'intro section') return 'intro_text'
  if (f === 'content section') return 'content_block'
  // Features / cards
  if (f === 'feature section') return /grid/.test(n) ? 'feature_grid' : 'feature_split'
  if (f === 'card') return 'card_grid'
  // CTA
  if (f === 'cta section') return 'cta_banner_simple'
  // People
  if (f === 'team section') return /carousel|slide/.test(n) ? 'team_carousel' : 'team_grid'
  if (f === 'single team section') return 'staff_member_detail'
  // Process / timeline
  if (f === 'process section') return 'steps_vertical'
  if (f === 'timeline section') return 'timeline_chronology'
  // FAQ
  if (f === 'faq section') return /grid/.test(n) ? 'faq_grid' : 'faq_accordion'
  // Filter
  if (f === 'category filter') return 'category_filter'
  // Single content
  if (f === 'single event section') return 'event_detail'
  if (f === 'single post section') return 'post_detail'
  // Gallery
  if (f === 'gallery section') return /carousel|slide/.test(n) ? 'gallery_carousel' : 'gallery_grid'
  // Career
  if (f === 'career section') return 'career_listing'
  // Blog
  if (f === 'blog section') return /featured/.test(n) ? 'blog_featured' : 'blog_listing'
  // Chrome
  if (f === 'header') return 'nav_header'
  if (f === 'footer') return 'footer_main'
  if (f === 'offcanvas') return 'offcanvas_menu'
  if (f === 'megamenu section') return 'megamenu'
  if (f === 'link page') return 'link_page'
  return null
}

/** Human-readable section name composed of page + ordinal + role.
 *  Used everywhere a section needs a "what is this" label that
 *  doesn't lock you into the underlying Brixies layout.
 *
 *  When `page` is null/undefined, the page-prefix is dropped — useful
 *  inside the page editor where the page context is already in the
 *  surrounding header. The composed label degrades to
 *  `Section N · Role label`. */
export function composeSectionName(opts: {
  page: Pick<WebPage, 'name'> | null
  section: Pick<WebSection, 'sort_order' | 'section_role' | 'section_role_label'>
  /** Compact = drop the "Section N" middle when role is descriptive enough.
   *  Default false (verbose for the swap board + section header). */
  compact?: boolean
}): string {
  const { page, section, compact = false } = opts
  const pageName = page?.name?.trim() ?? null
  const ordinal  = `Section ${(section.sort_order ?? 0) + 1}`
  const roleLabel = section.section_role_label?.trim()
    || (section.section_role ? SECTION_ROLE_LABELS[section.section_role] : null)
    || 'Unclassified'
  const middle = compact && roleLabel !== 'Unclassified' ? null : ordinal
  return [pageName, middle, roleLabel].filter(Boolean).join(' · ')
}
