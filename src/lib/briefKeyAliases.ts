/**
 * Shared semantic alias dictionary for mapping partner-brief field
 * names onto Brixies template slot keys.
 *
 * Before this lived split across two files:
 *   • webBindTemplate.ts had SYNONYM_GROUPS for the FIRST-PASS auto-
 *     bind that runs at brief-import time.
 *   • webUnmappedMapper.ts had a richer NAME_ALIASES + STAFF_KEY_
 *     ALIASES set used ONLY by the "Move to →" fallback the
 *     strategist clicks through manually.
 *
 * The split meant first-pass bind was dumber than the fallback.
 * Briefs that COULD have auto-bound landed in `__unmapped` and made
 * the strategist do the work the system already knew how to do.
 *
 * This file is the single source of truth. Both surfaces import
 * `BRIEF_KEY_ALIAS_GROUPS` and use `canonicalAliasFor()` /
 * `keysAreAliases()`.
 *
 * Each group is a Set of strings that all share a canonical name —
 * the FIRST entry of each group is the canonical. So `cta` is the
 * canonical for [cta, ctas, button, buttons, link, links, primary_cta,
 * secondary_cta, action, actions, …].
 *
 * The bag is intentionally permissive — the trade-off is occasional
 * false matches (a "content" field that's not body) vs missed matches
 * (silently empty slots). The audit on member 3490's bound sections
 * showed missing-match was the dominant problem; this leans toward
 * permissive.
 */

/** Lower-case, separator-stripped canonical form. */
export function canonicalKeyString(k: string): string {
  return k.toLowerCase().replace(/[\s_\-]+/g, '')
}

/** Each inner array is a synonym group. Canonical = group[0]
 *  (also the first entry). Order matters for the canonical-name
 *  resolution; downstream callers sort by group[0]. */
export const BRIEF_KEY_ALIAS_GROUPS: readonly string[][] = [
  // ── Text content ────────────────────────────────────────────
  [
    'heading',
    'h', 'h1', 'h2', 'h3',
    'title', 'headline', 'header',
    'section_heading', 'section_title',
    'name',                                    // staff cards: name → heading
  ],
  [
    'subheading',
    'subhead', 'sub_heading', 'sub_title', 'subtitle',
    'secondary_heading', 'section_subheading',
  ],
  [
    'tagline',
    'eyebrow', 'kicker', 'overline', 'pretitle',
    'pre_title', 'pre_heading', 'preheading',
    'super_heading', 'superheading',
    'badge',                                    // newer card layouts
    'category', 'topic',                        // cowork sometimes
  ],
  [
    'description',
    'body', 'content', 'copy', 'text', 'paragraph',
    'subtext', 'intro', 'closer', 'lede', 'lead',
    'pitch', 'summary', 'excerpt', 'blurb',
    'detail', 'details', 'info',
    'caption', 'bio',                           // staff bio → description
    'role',                                     // staff role → description
    'message',                                  // some CTAs use 'message'
  ],

  // ── Imagery ─────────────────────────────────────────────────
  [
    'image',
    'hero_image', 'photo', 'picture', 'illustration',
    'cover', 'featured_image', 'splash', 'banner',
    'thumbnail', 'thumb', 'icon', 'graphic',
    'avatar', 'headshot',                       // staff cards
    'logo',
  ],
  [
    'images',
    'photos', 'gallery', 'pictures', 'photo_grid', 'media',
  ],

  // ── CTAs ────────────────────────────────────────────────────
  [
    'cta',
    'ctas', 'button', 'buttons',
    'link', 'links', 'url',
    'action', 'actions',
    'primary_cta', 'secondary_cta', 'tertiary_cta',
    'cta_inline', 'inline_cta',
    'sign_up_link', 'signup_link', 'register_link',
    'email',                                    // staff cards: email → cta
  ],

  // ── Repeating containers ────────────────────────────────────
  [
    'cards',
    'card', 'items', 'item',
    'features', 'feature',
    'tiles', 'tile', 'blocks', 'block',
    'list', 'rows', 'tabs', 'tab',
    'programs', 'program',                      // cowork ministry cards
    'people', 'staff', 'staff_cards', 'team', 'team_members',
    'sermons', 'sermon_list',
    'events', 'event_list', 'event',
    'testimonials', 'testimony', 'stories',
    'faqs', 'faq', 'questions',
    'classes', 'groups',
    'partners', 'sponsors',
  ],
  [
    'steps',
    'step', 'process_steps', 'process_items', 'stages',
    'milestones', 'phases',
  ],
  [
    'quote',
    'testimonial', 'pull_quote', 'pullquote',
  ],
  [
    'author',
    'author_name', 'attribution', 'speaker', 'quoted',
    'fullname', 'full_name',
  ],

  // ── Layout-shape (kept for narrow templates) ────────────────
  [ 'container_left',  'left',  'left_column',  'leftcolumn' ],
  [ 'container_right', 'right', 'right_column', 'rightcolumn' ],
]

/** Precomputed index: any normalized variant → its canonical
 *  (also normalized). O(1) lookup. */
export const BRIEF_KEY_CANONICAL_INDEX: Map<string, string> = (() => {
  const m = new Map<string, string>()
  for (const group of BRIEF_KEY_ALIAS_GROUPS) {
    const canonical = canonicalKeyString(group[0])
    for (const variant of group) m.set(canonicalKeyString(variant), canonical)
  }
  return m
})()

/** Resolve a key (potentially scope-suffixed like `heading_card` or
 *  prefix-decorated like `primary_cta`) to its canonical concept.
 *
 *  Tries in order:
 *    1. Direct lookup on the normalized key.
 *    2. Suffix strip (drop trailing _segment one at a time, right→left).
 *    3. Prefix strip (drop leading segment_ one at a time, left→right).
 *
 *  Falls back to the normalized key when nothing matches — so a slot
 *  named `mystery_field` still has SOMETHING to compare against, just
 *  uniquely. */
export function canonicalAliasFor(k: string): string {
  const n = canonicalKeyString(k)
  if (BRIEF_KEY_CANONICAL_INDEX.has(n)) return BRIEF_KEY_CANONICAL_INDEX.get(n)!
  const parts = k.toLowerCase().split(/[_\s-]+/).filter(Boolean)
  if (parts.length > 1) {
    // Suffix-strip — heading_card → heading.
    for (let cut = 1; cut < parts.length; cut++) {
      const candidate = canonicalKeyString(parts.slice(0, parts.length - cut).join(''))
      if (BRIEF_KEY_CANONICAL_INDEX.has(candidate)) return BRIEF_KEY_CANONICAL_INDEX.get(candidate)!
    }
    // Prefix-strip — primary_cta → cta.
    for (let cut = 1; cut < parts.length; cut++) {
      const candidate = canonicalKeyString(parts.slice(cut).join(''))
      if (BRIEF_KEY_CANONICAL_INDEX.has(candidate)) return BRIEF_KEY_CANONICAL_INDEX.get(candidate)!
    }
  }
  return n
}

/** True when two keys resolve to the same canonical alias. */
export function keysAreAliases(a: string, b: string): boolean {
  return canonicalAliasFor(a) === canonicalAliasFor(b)
}
