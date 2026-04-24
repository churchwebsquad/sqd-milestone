/**
 * Controlled vocabulary for the brand guide's `style_tags` column. Shared
 * between the brand-guide editor (chip picker) and the handoff doc
 * Overview tab (badges) so tags render consistently and auto-complete is
 * closed-vocabulary.
 *
 * Evolution path: move to a `strategy_brand_style_tags` table when/if
 * we need per-division custom tags. For v1 a flat hard-coded list is fine —
 * the brand squad has asked for descriptors that cluster around a handful
 * of well-understood axes (tone, temperature, energy, craft).
 */

export const STYLE_TAG_OPTIONS = [
  // Visual weight / complexity
  'minimal',
  'bold',
  'high-contrast',
  'colorful',
  'muted',
  // Temperature
  'warm',
  'cool',
  // Era / voice
  'modern',
  'classic',
  'vintage',
  // Energy
  'energetic',
  'calm',
  'playful',
  'sophisticated',
  // Craft
  'hand-drawn',
  'geometric',
  'photographic',
  // Posture
  'edgy',
  'approachable',
  'reverent',
] as const

export type StyleTag = typeof STYLE_TAG_OPTIONS[number]

export function isStyleTag(s: string): s is StyleTag {
  return (STYLE_TAG_OPTIONS as readonly string[]).includes(s)
}
