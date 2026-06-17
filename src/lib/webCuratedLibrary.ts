/**
 * Curated Brixies library — site-specific palette.
 *
 * The Global Elements workspace presents this list as a checklist.
 * Strategist binds one (or a few) Brixies templates to each concept.
 * Bindings persist on `strategy_web_projects.curated_library` jsonb
 * (v34 migration) as `{ [conceptId]: [templateId, …] }`.
 *
 * AI auto-bind (Phase 3) consults the curated library before falling
 * back to the global catalog — so a site that has Ministry Card =
 * card-12 always uses card-12 when an AI suggestion calls for a
 * "Ministry Card," regardless of what scores higher in the global
 * catalog.
 */
import type { WebTemplateKind } from '../types/database'

export interface LibraryConcept {
  /** Stable identifier — used as the jsonb key. Never rename. */
  id: string
  /** Top-level group in the UI. */
  category: string
  /** Display label in the checklist. */
  label: string
  /** Short prose summary, shown under the label. */
  description: string
  /** Bulleted "Includes" hints — what should be in this concept's
   *  layout when the strategist picks a Brixies variant. */
  includes: string[]
  /** Filter the catalog picker by family name (case-insensitive,
   *  tolerant substring match — same rules as CatalogSidePanel). */
  familyFilter?: readonly string[]
  /** Filter the catalog picker by kind. Empty/omitted = all kinds. */
  kindFilter?: readonly WebTemplateKind[]
  /** How many templates the strategist can bind to this concept. */
  maxPicks: number
  /** System-wide fallback when a project hasn't picked anything. The
   *  effective bindings (see `getEffectiveBindings`) include this id
   *  when the project's curated_library has nothing explicit for the
   *  concept. Surfaces in the Global Elements UI as a "Default" badge
   *  the strategist can override per project. */
  defaultTemplateId?: string
}

export const LIBRARY_CONCEPTS: readonly LibraryConcept[] = [
  // ── Navigation ───────────────────────────────────────────────────
  {
    id: 'nav_header',
    category: 'Navigation',
    label: 'Header Navigation',
    description: 'Primary site navigation used across all pages to guide users to key areas.',
    includes: ['Logo', 'Navigation links', 'Dropdown menus or off-canvas menu', 'CTA button', 'Mobile navigation (hamburger)'],
    familyFilter: ['Header'],
    kindFilter: ['chrome'],
    maxPicks: 1,
  },
  {
    id: 'nav_footer',
    category: 'Navigation',
    label: 'Footer',
    description: 'Global footer providing secondary navigation, legal info, and social links.',
    includes: ['Quick links', 'Copyright text', 'Social media icons', 'Optional newsletter/signup'],
    familyFilter: ['Footer'],
    kindFilter: ['chrome'],
    maxPicks: 1,
  },

  // ── Cards ────────────────────────────────────────────────────────
  {
    id: 'card_ministry',
    category: 'Cards',
    label: 'Ministry Card',
    description: 'Used in carousels or grids to highlight ministries (kids, groups, outreach, etc.).',
    includes: ['Heading', 'Tagline', 'Description', 'Image/Icon', 'CTA'],
    familyFilter: ['Card'],
    kindFilter: ['component'],
    maxPicks: 1,
  },
  {
    id: 'card_staff',
    category: 'Cards',
    label: 'Staff Card',
    description: 'Displays team members in grids or carousels for staff directories.',
    includes: ['Name', 'Title', 'Photo', 'Email/Contact link'],
    familyFilter: ['Card'],
    kindFilter: ['component'],
    maxPicks: 1,
  },
  {
    id: 'card_event',
    category: 'Cards',
    label: 'Event Card',
    description: 'Used to promote upcoming events in grids, carousels, or archive lists.',
    includes: ['Event title', 'Date', 'Thumbnail image', 'Optional CTA'],
    familyFilter: ['Card'],
    kindFilter: ['component'],
    maxPicks: 1,
  },
  {
    id: 'card_info',
    category: 'Cards',
    label: 'Info Card',
    description: 'General-purpose card for highlighting key information or calls-to-action.',
    includes: ['Heading', 'Description', 'Icon/Image', 'CTA'],
    familyFilter: ['Card'],
    kindFilter: ['component'],
    maxPicks: 1,
  },
  {
    id: 'card_sermon',
    category: 'Cards',
    label: 'Sermon Card',
    description: 'Displays sermons in lists or carousels for browsing content.',
    includes: ['Sermon title', 'Date', 'Thumbnail image', 'Optional speaker'],
    familyFilter: ['Card'],
    kindFilter: ['component'],
    maxPicks: 1,
  },
  {
    id: 'card_process',
    category: 'Cards',
    label: 'Process Card',
    description: 'Used to illustrate steps in a process (Next Steps, Giving, etc.).',
    includes: ['Step number', 'Heading', 'Description', 'Icon/Image'],
    familyFilter: ['Card'],
    kindFilter: ['component'],
    maxPicks: 1,
  },
  {
    id: 'card_testimonial',
    category: 'Cards',
    label: 'Written Testimonial Card',
    description: 'Highlights quotes or testimonials from individuals.',
    includes: ['Quote text', 'Name', 'Optional title/role', 'Optional image'],
    familyFilter: ['Card'],
    kindFilter: ['component'],
    maxPicks: 1,
  },

  // ── Accordion ────────────────────────────────────────────────────
  {
    id: 'accordion_faq',
    category: 'Accordion',
    label: 'Accordion (FAQ / Expandable Content)',
    description: 'Collapsible content sections used for FAQs or grouped information.',
    includes: ['Section title', 'Expand/collapse states (open/closed)', 'Body content'],
    familyFilter: ['FAQ Section'],
    kindFilter: ['content'],
    maxPicks: 1,
    defaultTemplateId: 'faq-section-10',
  },

  // ── Hero Sections ────────────────────────────────────────────────
  {
    id: 'hero_homepage',
    category: 'Hero Sections',
    label: 'Homepage Hero',
    description: 'Primary above-the-fold section introducing the brand and guiding users to key actions.',
    includes: ['Image/video', 'Tagline', 'Heading', 'Subheading', 'CTA(s)'],
    familyFilter: ['Hero Section'],
    kindFilter: ['content'],
    maxPicks: 1,
    defaultTemplateId: 'hero-section-102',
  },
  {
    id: 'hero_inner',
    category: 'Hero Sections',
    label: 'Inner Page Hero',
    description: 'Hero used on internal pages to introduce specific sections (kids, groups, outreach).',
    includes: ['Image/video', 'Tagline', 'Heading', 'Subheading', 'CTA(s)'],
    familyFilter: ['Hero Section'],
    kindFilter: ['content'],
    maxPicks: 1,
    defaultTemplateId: 'hero-section-1',
  },
  {
    id: 'hero_featured',
    category: 'Hero Sections',
    label: 'Featured Page Hero',
    description: 'High-impact hero for key conversion pages (e.g., Plan A Visit).',
    includes: ['Image/video', 'Tagline', 'Heading', 'Subheading', 'CTA(s)'],
    familyFilter: ['Hero Section'],
    kindFilter: ['content'],
    maxPicks: 1,
    defaultTemplateId: 'hero-section-43',
  },

  // ── CTA Banners ──────────────────────────────────────────────────
  {
    id: 'cta_simple',
    category: 'CTA Banners',
    label: 'Simple CTA Banner',
    description: 'Lightweight call-to-action section used between content blocks.',
    includes: ['Heading', 'Short description', 'CTA button'],
    familyFilter: ['CTA Section', 'Banner Section'],
    kindFilter: ['content'],
    maxPicks: 1,
    defaultTemplateId: 'cta-section-20',
  },
  {
    id: 'cta_callout',
    category: 'CTA Banners',
    label: 'Callout CTA Banner',
    description: 'Prominent CTA section designed to stand out and drive conversions.',
    includes: ['Heading', 'Supporting text', 'Background styling', 'CTA(s)'],
    familyFilter: ['CTA Section', 'Banner Section'],
    kindFilter: ['content'],
    maxPicks: 1,
    defaultTemplateId: 'cta-section-52',
  },

  // ── Content Sections ─────────────────────────────────────────────
  {
    id: 'content_image_text',
    category: 'Content Sections',
    label: 'Image Left / Text Right',
    description: 'Standard content layout pairing imagery with supporting text. Pick up to 2 variants.',
    includes: ['Image', 'Heading', 'Body copy', 'CTA buttons'],
    familyFilter: ['Content Section', 'Intro Section'],
    kindFilter: ['content'],
    maxPicks: 2,
    defaultTemplateId: 'content-section-45',
  },
  {
    id: 'content_featured',
    category: 'Content Sections',
    label: 'Featured Content Section',
    description: 'Highlights key content like events, milestones, or announcements. Pick up to 2 variants.',
    includes: ['Section heading', 'Featured items/cards', 'Optional CTA'],
    familyFilter: ['Content Section', 'Feature Section'],
    kindFilter: ['content'],
    maxPicks: 2,
    defaultTemplateId: 'content-section-89',
  },
  {
    id: 'content_video',
    category: 'Content Sections',
    label: 'Video Section',
    description: 'Section dedicated to video content such as sermons or stories.',
    includes: ['Video embed or playlist', 'Heading', 'Optional description'],
    familyFilter: ['Content Section', 'Gallery Section'],
    kindFilter: ['content', 'media'],
    maxPicks: 1,
    defaultTemplateId: 'content-section-25',
  },

  // ── Feature Sections ─────────────────────────────────────────────
  {
    id: 'feature_card_grid',
    category: 'Feature Sections',
    label: 'Card Grid',
    description: 'Displays multiple cards in a structured grid layout.',
    includes: ['Section heading', 'Card collection', 'Optional CTA'],
    familyFilter: ['Feature Section'],
    kindFilter: ['content'],
    maxPicks: 1,
    defaultTemplateId: 'feature-section-2',
  },
  {
    id: 'feature_card_carousel',
    category: 'Feature Sections',
    label: 'Card Carousel',
    description: 'Horizontally scrollable card layout for showcasing content.',
    includes: ['Section heading', 'Scrollable cards', 'Navigation controls'],
    familyFilter: ['Feature Section'],
    kindFilter: ['content'],
    maxPicks: 1,
    defaultTemplateId: 'feature-section-82',
  },
  {
    id: 'feature_tabbed',
    category: 'Feature Sections',
    label: 'Tabbed / Nested Section',
    description: 'Organizes large amounts of content into tabs or nested views.',
    includes: ['Tabs/navigation', 'Content panels', 'Headings', 'Body content'],
    familyFilter: ['Feature Section'],
    kindFilter: ['content'],
    maxPicks: 1,
    defaultTemplateId: 'feature-section-66',
  },
  {
    id: 'feature_unique',
    category: 'Feature Sections',
    label: 'Unique Feature Section',
    description: 'Flexible, multi-purpose layout used for custom storytelling or design needs.',
    includes: ['Combination of text, media, and CTAs depending on use case'],
    familyFilter: ['Feature Section', 'Process Section'],
    kindFilter: ['content'],
    maxPicks: 1,
    defaultTemplateId: 'feature-section-103',
  },
  {
    id: 'feature_team',
    category: 'Feature Sections',
    label: 'Team Section',
    description: 'Displays staff members in a grid or carousel format.',
    includes: ['Section heading', 'Staff cards', 'Optional CTA'],
    familyFilter: ['Team Section'],
    kindFilter: ['content'],
    maxPicks: 1,
    defaultTemplateId: 'team-section-14',
  },

  // ── Archive ──────────────────────────────────────────────────────
  {
    id: 'archive_filter',
    category: 'Archive',
    label: 'Filter Layout',
    description: 'Archive view for browsing content (events, sermons, blog) with filtering.',
    includes: ['Filter controls', 'Search', 'Card grid/list'],
    familyFilter: ['Category Filter', 'Blog Section'],
    kindFilter: ['functional', 'content'],
    maxPicks: 1,
    defaultTemplateId: 'category-filter-6',
  },
  {
    id: 'archive_current_series',
    category: 'Archive',
    label: 'Current Series Section',
    description: 'Highlights an active sermon series with related content.',
    includes: ['Series title', 'Description', 'Recent message cards'],
    familyFilter: ['Content Section', 'Feature Section'],
    kindFilter: ['content'],
    maxPicks: 1,
    defaultTemplateId: 'feature-section-6',
  },

  // ── Single Post Templates ────────────────────────────────────────
  {
    id: 'single_event',
    category: 'Single Post Templates',
    label: 'Single Event',
    description: 'Detailed page for an individual event.',
    includes: ['Thumbnail', 'Title', 'Date', 'Location', 'Register CTA', 'Description'],
    familyFilter: ['Single Event Section'],
    kindFilter: ['post_template'],
    maxPicks: 1,
    defaultTemplateId: 'single-event-section-4',
  },
  {
    id: 'single_blog',
    category: 'Single Post Templates',
    label: 'Single Blog Post',
    description: 'Template for blog content and articles.',
    includes: ['Title', 'Metadata (author/date)', 'Thumbnail', 'Body content', 'Featured sermon'],
    familyFilter: ['Single Post Section'],
    kindFilter: ['post_template'],
    maxPicks: 1,
    defaultTemplateId: 'single-post-section-8',
  },
  {
    id: 'single_staff',
    category: 'Single Post Templates',
    label: 'Single Staff Member',
    description: 'Profile page for individual staff members.',
    includes: ['Name/Title', 'Headshot', 'Bio', 'Contact information'],
    familyFilter: ['Single Team Section'],
    kindFilter: ['post_template'],
    maxPicks: 1,
    defaultTemplateId: 'single-team-section-6',
  },
  {
    id: 'single_sermon',
    category: 'Single Post Templates',
    label: 'Single Sermon',
    description: 'Detailed page for a sermon message.',
    includes: ['Title', 'Speaker', 'Date', 'Series', 'Description', 'Video embed'],
    familyFilter: ['Single Post Section', 'Single Event Section'],
    kindFilter: ['post_template'],
    maxPicks: 1,
    defaultTemplateId: 'single-event-section-4',
  },

  // ── Timeline / Story ─────────────────────────────────────────────
  {
    id: 'timeline_story',
    category: 'Timeline / Story',
    label: 'Timeline / Story Section',
    description: 'Visual storytelling component used to present history or milestones.',
    includes: ['Timeline entries', 'Dates', 'Descriptions', 'Optional images'],
    familyFilter: ['Timeline Section'],
    kindFilter: ['content'],
    maxPicks: 1,
    defaultTemplateId: 'timeline-section-6',
  },

  // ── Testimonial ──────────────────────────────────────────────────
  {
    id: 'testimonial_video',
    category: 'Testimonial',
    label: 'Video Testimonial Section',
    description: 'Showcases multiple video stories for social proof.',
    includes: ['Name', 'Video link/embed', 'Short description'],
    familyFilter: ['Gallery Section', 'Feature Section'],
    kindFilter: ['content', 'media'],
    maxPicks: 1,
    defaultTemplateId: 'feature-section-77',
  },
  {
    id: 'testimonial_written',
    category: 'Testimonial',
    label: 'Written Testimonial Page',
    description: 'Dedicated page for written testimonials and stories.',
    includes: ['Quotes', 'Names', 'Optional images'],
    familyFilter: ['Content Section', 'Intro Section', 'Feature Section'],
    kindFilter: ['content'],
    maxPicks: 1,
    defaultTemplateId: 'feature-section-19',
  },

  // ── Contact ──────────────────────────────────────────────────────
  {
    id: 'contact_section',
    category: 'Contact',
    label: 'Contact Section',
    description: 'Provides essential contact details and ways to connect.',
    includes: ['Service times', 'Phone', 'Email', 'Address', 'Office hours', 'Contact form'],
    familyFilter: ['Content Section', 'Footer'],
    kindFilter: ['content'],
    maxPicks: 1,
    defaultTemplateId: 'content-section-96',
  },

  // ── Career ───────────────────────────────────────────────────────
  {
    id: 'career_section',
    category: 'Career',
    label: 'Career Section',
    description: 'Lists open job opportunities and role details.',
    includes: ['Job title', 'Department', 'Description', 'Role type', 'Application link'],
    familyFilter: ['Career Section'],
    kindFilter: ['content'],
    maxPicks: 1,
    defaultTemplateId: 'career-section-3',
  },
]

/** Ordered list of category names — drives the section grouping in the
 *  Global Elements workspace. */
export const LIBRARY_CATEGORIES: readonly string[] = (() => {
  const seen = new Set<string>()
  const out: string[] = []
  for (const c of LIBRARY_CONCEPTS) {
    if (!seen.has(c.category)) { seen.add(c.category); out.push(c.category) }
  }
  return out
})()

/** Group the concepts by category. Memoize at module load — the list
 *  is static. */
export const LIBRARY_BY_CATEGORY: Readonly<Record<string, readonly LibraryConcept[]>> = (() => {
  const out: Record<string, LibraryConcept[]> = {}
  for (const c of LIBRARY_CONCEPTS) {
    ;(out[c.category] ??= []).push(c)
  }
  return out
})()

// ── Load / save ─────────────────────────────────────────────────────

/** The stored shape of `strategy_web_projects.curated_library`. */
export type CuratedLibrary = Record<string, string[]>

/** Concept lookup by id — used by consumers that need to resolve a
 *  concept's default when its explicit binding is empty. */
export const LIBRARY_CONCEPT_BY_ID: Readonly<Record<string, LibraryConcept>> = (() => {
  const out: Record<string, LibraryConcept> = {}
  for (const c of LIBRARY_CONCEPTS) out[c.id] = c
  return out
})()

/** Effective bindings for a concept: explicit project bindings if any,
 *  otherwise the concept's `defaultTemplateId` if set, otherwise [].
 *  Use this anywhere "what counts as the site's pick for X" matters —
 *  catalog badge ranking, AI auto-bind, etc. */
export function getEffectiveBindings(library: CuratedLibrary, conceptId: string): string[] {
  const explicit = library[conceptId] ?? []
  if (explicit.length > 0) return explicit
  const fallback = LIBRARY_CONCEPT_BY_ID[conceptId]?.defaultTemplateId
  return fallback ? [fallback] : []
}

/** Flatten the project's library + system defaults into a single Set
 *  of template ids — the "site library" pool for catalog picker badges. */
export function getEffectiveLibraryIds(library: CuratedLibrary): Set<string> {
  const out = new Set<string>()
  for (const c of LIBRARY_CONCEPTS) {
    for (const id of getEffectiveBindings(library, c.id)) out.add(id)
  }
  return out
}

// ── Page-builder helpers ────────────────────────────────────────────
//
// The Global Elements workspace is the canonical editor, but the page
// builder also surfaces a "Save to site library" affordance on each
// bound section so the strategist can promote a variant to the
// project's palette without context-switching. These helpers do the
// concept-matching and shape mutation that affordance needs.

/** Subset of WebContentTemplate the matcher uses. Pull from anywhere —
 *  the actual template row, the imported palette card, etc. */
export interface LibraryMatchableTemplate {
  id:     string
  family: string | null
  kind:   WebTemplateKind | null
}

/** Find the LIBRARY_CONCEPTS this template could fit under. We check
 *  each concept's family + kind filters; if both pass, the concept is
 *  a candidate. The page-builder UI uses this to decide what concept
 *  label to show on the "Save to site library" button — and to show a
 *  picker when more than one concept accepts the template. */
export function findCandidateConcepts(
  template: LibraryMatchableTemplate,
): LibraryConcept[] {
  const out: LibraryConcept[] = []
  for (const c of LIBRARY_CONCEPTS) {
    if (c.kindFilter && c.kindFilter.length > 0) {
      if (!template.kind) continue
      if (!c.kindFilter.includes(template.kind)) continue
    }
    if (c.familyFilter && c.familyFilter.length > 0) {
      if (!template.family) continue
      const fam = template.family.toLowerCase()
      const matches = c.familyFilter.some(f => fam.includes(f.toLowerCase()))
      if (!matches) continue
    }
    out.push(c)
  }
  return out
}

/** Returns the concepts in `library` where this template is currently
 *  one of the explicit bindings. Used to show "✓ In Library" state on
 *  the page builder when the template is already a pick. */
export function findConceptsContainingTemplate(
  library: CuratedLibrary,
  templateId: string,
): LibraryConcept[] {
  const out: LibraryConcept[] = []
  for (const c of LIBRARY_CONCEPTS) {
    const explicit = library[c.id] ?? []
    if (explicit.includes(templateId)) out.push(c)
  }
  return out
}

/** Operation describing how `addOrReplaceLibraryBinding` resolves a
 *  Save request given the concept's current bindings + maxPicks. */
export type LibraryAddOp =
  | { kind: 'add' }                                // room available
  | { kind: 'replace'; replacesTemplateId: string } // user explicitly picks which to swap
  | { kind: 'already_present' }                    // template is already bound

/** Pure mutation: produce the next CuratedLibrary after adding the
 *  given template to the given concept. Caller passes the chosen
 *  operation. Persistence is the caller's job. */
export function addOrReplaceLibraryBinding(
  library: CuratedLibrary,
  conceptId: string,
  templateId: string,
  op: LibraryAddOp,
): CuratedLibrary {
  const current = library[conceptId] ?? []
  let next: string[]
  switch (op.kind) {
    case 'already_present':
      return library  // no-op
    case 'add':
      if (current.includes(templateId)) return library
      next = [...current, templateId]
      break
    case 'replace':
      next = current.map(id => id === op.replacesTemplateId ? templateId : id)
      // Dedupe in case the new id already existed somewhere else.
      next = Array.from(new Set(next))
      break
  }
  return { ...library, [conceptId]: next }
}

/** Remove a template id from a concept's bindings. Drops the concept
 *  key entirely when the binding becomes empty. */
export function removeLibraryBinding(
  library: CuratedLibrary,
  conceptId: string,
  templateId: string,
): CuratedLibrary {
  const current = library[conceptId] ?? []
  const next = current.filter(id => id !== templateId)
  const out: CuratedLibrary = { ...library }
  if (next.length === 0) delete out[conceptId]
  else out[conceptId] = next
  return out
}

/** Coerce a jsonb value to the typed CuratedLibrary shape, dropping
 *  anything that doesn't look right. Defensive — the column is jsonb
 *  with no schema, so old or hand-edited values might be malformed. */
export function parseCuratedLibrary(raw: unknown): CuratedLibrary {
  if (typeof raw !== 'object' || raw === null) return {}
  const out: CuratedLibrary = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (Array.isArray(v)) {
      const filtered = v.filter((x): x is string => typeof x === 'string')
      if (filtered.length > 0) out[k] = filtered
    } else if (typeof v === 'string') {
      // Tolerate legacy single-string values from earlier drafts.
      out[k] = [v]
    }
  }
  return out
}
