export type CaptionGroup = 'Traditional' | 'Elevated' | 'Reference' | 'Basic' | 'Custom'

export interface CaptionStyleMeta {
  slug:           string
  label:          string
  group:          CaptionGroup
  usesHighlight:  boolean
  usesBackground: boolean
  defaults: {
    textColor:       string
    highlightColor?: string
    bgColor?:        string
  }
}

// Core fields match Duane's CaptionStyleConfig from engine.ts exactly.
// captionSlug / wordsPerSegment / deliver9x16 are our app-level additions.
export interface CaptionStyleConfig {
  // App-level fields
  captionSlug?:     string
  wordsPerSegment?: number      // 0 = auto
  deliver9x16?:     boolean
  // Core fields (Duane engine.ts)
  fontFamily?:      string
  scale?:           number      // decimal: 0.7–1.4, default 1.0
  textColor?:       string
  highlightColor?:  string
  bgColor?:         string
  bgOpacity?:       number
  position?:        'top' | 'center' | 'bottom'
  offset?:          number      // px, -120 to 120, step 4
  textCase?:        'upper' | 'lower' | 'title' | 'as_typed'
  reverentCaps?:    boolean
  fontSizePx?:      number
  fontWeight?:      number
  letterSpacingEm?: number
  lineHeight?:      number
}

export const CAPTION_GROUPS: CaptionGroup[] = ['Traditional', 'Elevated', 'Reference', 'Basic', 'Custom']

export const CAPTION_STYLES: CaptionStyleMeta[] = [
  // Traditional
  { slug: 'cap01-hormozi-pill',    label: 'Spotlight Pill',      group: 'Traditional', usesHighlight: true,  usesBackground: true,  defaults: { textColor: '#1a1a1a',  highlightColor: '#FBA09C', bgColor: '#ffffff' } },
  { slug: 'cap02-mrbeast-pop',     label: 'MrBeast Pop',         group: 'Traditional', usesHighlight: true,  usesBackground: false, defaults: { textColor: '#ffffff',  highlightColor: '#FFE34F' } },
  { slug: 'cap03-youtube-bar',     label: 'YouTube Bar',         group: 'Traditional', usesHighlight: true,  usesBackground: true,  defaults: { textColor: '#ffffff',  highlightColor: '#ffffff', bgColor: '#000000' } },
  { slug: 'cap04-outline-classic', label: 'Outline Classic',     group: 'Traditional', usesHighlight: true,  usesBackground: false, defaults: { textColor: '#ffffff',  highlightColor: '#FBA09C' } },
  { slug: 'cap05-word-punch',      label: 'Word Punch',          group: 'Traditional', usesHighlight: false, usesBackground: false, defaults: { textColor: '#ffffff' } },
  { slug: 'cap06-fade-fill',       label: 'Fade Fill',           group: 'Traditional', usesHighlight: true,  usesBackground: true,  defaults: { textColor: '#341756',  highlightColor: '#513DE5', bgColor: '#F9F5F1' } },
  { slug: 'cap07-fade-slide-up',   label: 'Fade + Slide Up',     group: 'Traditional', usesHighlight: true,  usesBackground: false, defaults: { textColor: '#ffffff',  highlightColor: '#FBA09C' } },
  { slug: 'cap08-typewriter',      label: 'Typewriter',          group: 'Traditional', usesHighlight: true,  usesBackground: false, defaults: { textColor: '#ffffff',  highlightColor: '#FBA09C' } },
  { slug: 'cap09-brand-italic',    label: 'Brand Italic',        group: 'Traditional', usesHighlight: true,  usesBackground: false, defaults: { textColor: '#ffffff',  highlightColor: '#FBA09C' } },
  // Elevated
  { slug: 'cap11-liquid-morph',       label: 'Liquid Morph',        group: 'Elevated', usesHighlight: true,  usesBackground: true,  defaults: { textColor: '#341756',  highlightColor: '#FBA09C', bgColor: '#ffffff' } },
  { slug: 'cap14-stamped',            label: 'Stamped',             group: 'Elevated', usesHighlight: true,  usesBackground: false, defaults: { textColor: '#ffe7d6',  highlightColor: '#FBA09C' } },
  { slug: 'cap15-typewriter-glitch',  label: 'Typewriter Glitch',   group: 'Elevated', usesHighlight: true,  usesBackground: false, defaults: { textColor: '#ffffff',  highlightColor: '#FBA09C' } },
  { slug: 'cap16-chip-row',           label: 'Chip Row',            group: 'Elevated', usesHighlight: true,  usesBackground: false, defaults: { textColor: '#341756',  highlightColor: '#FBA09C' } },
  { slug: 'cap20-confession-quote',   label: 'Confession Quote',    group: 'Elevated', usesHighlight: true,  usesBackground: true,  defaults: { textColor: '#341756',  highlightColor: '#FBA09C', bgColor: '#F9F5F1' } },
  { slug: 'cap22-index-card-stack',   label: 'Index Card Stack',    group: 'Elevated', usesHighlight: true,  usesBackground: true,  defaults: { textColor: '#341756',  highlightColor: '#513DE5', bgColor: '#F9F5F1' } },
  { slug: 'cap23-neon-glow',          label: 'Neon Glow',           group: 'Elevated', usesHighlight: true,  usesBackground: false, defaults: { textColor: '#ffffff',  highlightColor: '#FBA09C' } },
  { slug: 'cap24-cinematic-fade',     label: 'Cinematic Fade',      group: 'Elevated', usesHighlight: true,  usesBackground: false, defaults: { textColor: '#ffffff',  highlightColor: '#FBA09C' } },
  { slug: 'cap25-caret-cursor',       label: 'Caret Cursor',        group: 'Elevated', usesHighlight: true,  usesBackground: true,  defaults: { textColor: '#ffffff',  highlightColor: '#FBA09C', bgColor: '#140820' } },
  { slug: 'cap26-vinyl-tracking',     label: 'Vinyl Tracking',      group: 'Elevated', usesHighlight: true,  usesBackground: false, defaults: { textColor: '#ffffff',  highlightColor: '#FBA09C' } },
  // Reference
  { slug: 'cap31-outline-pop',    label: 'Outline Pop',   group: 'Reference', usesHighlight: true,  usesBackground: false, defaults: { textColor: '#ffffff',  highlightColor: '#FFC83D' } },
  { slug: 'cap32-framed-card',    label: 'Framed Card',   group: 'Reference', usesHighlight: false, usesBackground: false, defaults: { textColor: '#ffffff' } },
  { slug: 'cap33-bold-emphasis',  label: 'Bold Emphasis', group: 'Reference', usesHighlight: true,  usesBackground: false, defaults: { textColor: '#ffffff',  highlightColor: '#FBA09C' } },
  // Basic
  { slug: 'cap40-simple-clean',   label: 'Simple Clean',   group: 'Basic', usesHighlight: false, usesBackground: false, defaults: { textColor: '#ffffff' } },
  { slug: 'cap41-simple-boxed',   label: 'Simple Boxed',   group: 'Basic', usesHighlight: false, usesBackground: true,  defaults: { textColor: '#ffffff', bgColor: '#000000' } },
  { slug: 'cap42-bold-statement', label: 'Bold Statement', group: 'Basic', usesHighlight: false, usesBackground: false, defaults: { textColor: '#ffffff' } },
]

export const CUSTOM_SLUG = 'cap99-custom'

export const CUSTOM_STYLE_META: CaptionStyleMeta = {
  slug:           CUSTOM_SLUG,
  label:          'Custom',
  group:          'Custom',
  usesHighlight:  true,
  usesBackground: true,
  defaults:       { textColor: '#ffffff', highlightColor: '#FBA09C', bgColor: '#000000' },
}

export function styleBySlug(slug: string): CaptionStyleMeta | undefined {
  return CAPTION_STYLES.find(s => s.slug === slug) ??
    (slug === CUSTOM_SLUG ? CUSTOM_STYLE_META : undefined)
}

export const DEFAULT_CAPTION_CFG: CaptionStyleConfig = {
  captionSlug:    'cap01-hormozi-pill',
  wordsPerSegment: 0,
  deliver9x16:    false,
  textColor:      '#1a1a1a',
  highlightColor: '#FBA09C',
  bgColor:        '#ffffff',
  position:       'center',
  textCase:       'as_typed',
  scale:          1.0,
  offset:         0,
  reverentCaps:   false,
}
