export type CaptionGroup = 'Traditional' | 'Elevated' | 'Reference' | 'Basic'

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

export const CAPTION_GROUPS: CaptionGroup[] = ['Traditional', 'Elevated', 'Reference', 'Basic']

export const CAPTION_STYLES: CaptionStyleMeta[] = [
  // Traditional
  { slug: 'cap01-hormozi-pill',    label: 'Spotlight Pill',      group: 'Traditional', usesHighlight: true,  usesBackground: false, defaults: { textColor: '#ffffff', highlightColor: '#F8A81C' } },
  { slug: 'cap02-mrbeast-pop',     label: 'MrBeast Pop',         group: 'Traditional', usesHighlight: true,  usesBackground: false, defaults: { textColor: '#ffffff', highlightColor: '#FFD600' } },
  { slug: 'cap03-youtube-bar',     label: 'YouTube Bar',         group: 'Traditional', usesHighlight: false, usesBackground: true,  defaults: { textColor: '#ffffff', bgColor: '#CC0000' } },
  { slug: 'cap04-outline-classic', label: 'Outline Classic',     group: 'Traditional', usesHighlight: false, usesBackground: false, defaults: { textColor: '#ffffff' } },
  { slug: 'cap05-word-punch',      label: 'Word Punch',          group: 'Traditional', usesHighlight: true,  usesBackground: false, defaults: { textColor: '#ffffff', highlightColor: '#513DE5' } },
  { slug: 'cap06-fade-fill',       label: 'Fade Fill',           group: 'Traditional', usesHighlight: false, usesBackground: true,  defaults: { textColor: '#ffffff', bgColor: '#000000' } },
  { slug: 'cap07-fade-slide-up',   label: 'Fade + Slide Up',     group: 'Traditional', usesHighlight: false, usesBackground: false, defaults: { textColor: '#ffffff' } },
  { slug: 'cap08-typewriter',      label: 'Typewriter',          group: 'Traditional', usesHighlight: false, usesBackground: false, defaults: { textColor: '#ffffff' } },
  { slug: 'cap09-brand-italic',    label: 'Brand Italic',        group: 'Traditional', usesHighlight: true,  usesBackground: false, defaults: { textColor: '#ffffff', highlightColor: '#CFC9F8' } },
  // Elevated
  { slug: 'cap11-liquid-morph',       label: 'Liquid Morph',        group: 'Elevated', usesHighlight: true,  usesBackground: false, defaults: { textColor: '#ffffff', highlightColor: '#513DE5' } },
  { slug: 'cap14-stamped',            label: 'Stamped',             group: 'Elevated', usesHighlight: false, usesBackground: true,  defaults: { textColor: '#ffffff', bgColor: '#341756' } },
  { slug: 'cap15-typewriter-glitch',  label: 'Typewriter Glitch',   group: 'Elevated', usesHighlight: false, usesBackground: false, defaults: { textColor: '#ffffff' } },
  { slug: 'cap16-chip-row',           label: 'Chip Row',            group: 'Elevated', usesHighlight: true,  usesBackground: false, defaults: { textColor: '#ffffff', highlightColor: '#F8A81C' } },
  { slug: 'cap20-confession-quote',   label: 'Confession Quote',    group: 'Elevated', usesHighlight: false, usesBackground: false, defaults: { textColor: '#ffffff' } },
  { slug: 'cap22-index-card-stack',   label: 'Index Card Stack',    group: 'Elevated', usesHighlight: false, usesBackground: true,  defaults: { textColor: '#341756', bgColor: '#ffffff' } },
  { slug: 'cap23-neon-glow',          label: 'Neon Glow',           group: 'Elevated', usesHighlight: false, usesBackground: false, defaults: { textColor: '#a855f7' } },
  { slug: 'cap24-cinematic-fade',     label: 'Cinematic Fade',      group: 'Elevated', usesHighlight: false, usesBackground: false, defaults: { textColor: '#ffffff' } },
  { slug: 'cap25-caret-cursor',       label: 'Caret Cursor',        group: 'Elevated', usesHighlight: false, usesBackground: false, defaults: { textColor: '#ffffff' } },
  { slug: 'cap26-vinyl-tracking',     label: 'Vinyl Tracking',      group: 'Elevated', usesHighlight: false, usesBackground: false, defaults: { textColor: '#ffffff' } },
  // Reference
  { slug: 'cap31-outline-pop',    label: 'Outline Pop',   group: 'Reference', usesHighlight: true,  usesBackground: false, defaults: { textColor: '#ffffff', highlightColor: '#513DE5' } },
  { slug: 'cap32-framed-card',    label: 'Framed Card',   group: 'Reference', usesHighlight: false, usesBackground: true,  defaults: { textColor: '#ffffff', bgColor: '#000000' } },
  { slug: 'cap33-bold-emphasis',  label: 'Bold Emphasis', group: 'Reference', usesHighlight: true,  usesBackground: false, defaults: { textColor: '#ffffff', highlightColor: '#FFD600' } },
  // Basic
  { slug: 'cap40-simple-clean',   label: 'Simple Clean',   group: 'Basic', usesHighlight: false, usesBackground: false, defaults: { textColor: '#ffffff' } },
  { slug: 'cap41-simple-boxed',   label: 'Simple Boxed',   group: 'Basic', usesHighlight: false, usesBackground: true,  defaults: { textColor: '#ffffff', bgColor: '#000000' } },
  { slug: 'cap42-bold-statement', label: 'Bold Statement', group: 'Basic', usesHighlight: false, usesBackground: false, defaults: { textColor: '#ffffff' } },
]

export function styleBySlug(slug: string): CaptionStyleMeta | undefined {
  return CAPTION_STYLES.find(s => s.slug === slug)
}

export interface CaptionStyleConfig {
  captionSlug:     string
  textColor:       string
  highlightColor:  string
  font:            string
  position:        string
  textCase:        string
  sizePct:         number
  wordsPerSegment: string
  reverentCaps:    boolean
  deliver9x16:     boolean
}

export const DEFAULT_CAPTION_CFG: CaptionStyleConfig = {
  captionSlug:     'cap01-hormozi-pill',
  textColor:       '#ffffff',
  highlightColor:  '#F8A81C',
  font:            '',
  position:        'Bottom',
  textCase:        'As typed',
  sizePct:         100,
  wordsPerSegment: 'Auto',
  reverentCaps:    false,
  deliver9x16:     false,
}
